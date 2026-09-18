"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dictation, via the browser's own recogniser.
 *
 * cipher: the Web Speech API. It costs nothing, needs no server and no key,
 * and ships today — Chrome, Edge and Safari all have it. The price is that
 * Chrome streams the audio to Google, Firefox has none of it, and accuracy on
 * ticker symbols is mediocre (which lib/voice/normalise.ts exists to absorb).
 *
 * The upgrade, when voice earns it, is a /api/transcribe route in front of
 * Whisper or Deepgram: better accuracy, one vendor, ~$0.006/min, and it works
 * in every browser. Nothing outside this file has to change — the hook's
 * shape is the contract.
 *
 * Requires a secure context. localhost counts; production is HTTPS anyway.
 */

/*
 * The Web Speech API is not in lib.dom, so the shapes it returns are declared
 * here. Deliberately minimal: only the members actually read below, so this
 * cannot drift into claiming support for things that were never tested.
 */
interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechAlternative;
}
interface SpeechResultList {
  readonly length: number;
  [index: number]: SpeechResult;
}
interface SpeechEvent extends Event {
  resultIndex: number;
  results: SpeechResultList;
}
interface SpeechErrorEvent extends Event {
  error: string;
}
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Every way this fails, in words a person can act on.
 *
 * A microphone button that goes dead and says nothing is worse than no
 * microphone button, because the user cannot tell whether it is broken, they
 * are muted, or it simply did not hear them.
 */
const MESSAGES: Record<string, string> = {
  "not-allowed":
    "Your browser is blocking the microphone. Allow it in the address bar and tap again.",
  "service-not-allowed":
    "Your browser is blocking the microphone. Allow it in the address bar and tap again.",
  "audio-capture": "No microphone found. Plug one in or check your input device.",
  network: "Speech recognition needs the network and could not reach it.",
  "no-speech": "I didn't hear anything.",
  aborted: "",
};

/** How long a pause ends the sentence. */
const SILENCE_MS = 2_500;

export interface Speech {
  /** False in Firefox, in insecure contexts, and during SSR. */
  supported: boolean;
  listening: boolean;
  /** Words heard so far this session, growing as they are confirmed. */
  transcript: string;
  /** The unconfirmed tail. Shown greyed so the user sees it working. */
  interim: string;
  error: string | null;
  start(): void;
  stop(): void;
}

/**
 * Send the recorded clip for the authoritative transcript.
 *
 * Returns "" on ANY failure — no key configured, network down, slow vendor —
 * and the caller falls back to what the browser already heard. Voice can only
 * ever get better than it was before this existed, never worse.
 */
async function transcribe(blob: Blob, keyterms: string[]): Promise<string> {
  if (blob.size === 0) return "";
  try {
    const q = keyterms.length ? `?keyterms=${encodeURIComponent(keyterms.join(","))}` : "";
    const res = await fetch(`/api/transcribe${q}`, {
      method: "POST",
      headers: { "Content-Type": blob.type || "audio/webm" },
      body: blob,
      /* Past this the browser's own text is the better answer than waiting. */
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return "";
    const body = (await res.json()) as { transcript?: unknown };
    return typeof body.transcript === "string" ? body.transcript.trim() : "";
  } catch {
    return "";
  }
}

export function useSpeech(
  onFinal?: (text: string) => void,
  /**
   * The coins worth listening for — the open market, the list on screen, what
   * the user holds. A getter rather than an array so it is read at the moment
   * the clip is sent, not frozen at the render that opened the microphone.
   */
  getKeyterms?: () => string[],
): Speech {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<Recognition | null>(null);
  const silenceRef = useRef<number | null>(null);
  const finalRef = useRef("");
  /* Held in a ref so changing the callback does not tear down a live
     recognition session mid-sentence. */
  const cbRef = useRef(onFinal);
  cbRef.current = onFinal;
  const keytermsRef = useRef(getKeyterms);
  keytermsRef.current = getKeyterms;

  /*
   * The recording that runs alongside the browser recogniser.
   *
   * SESSION, because the Deepgram reply is asynchronous and can arrive after
   * the user has already tapped the mic again. Without it a stale transcript
   * from the abandoned session would fire onFinal into the new one — an order
   * nobody is currently speaking.
   */
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sessionRef = useRef(0);

  const releaseMic = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  /* Support is checked after mount: the server has no window, and rendering a
     mic button that vanishes on hydration is a layout shift on every load. */
  useEffect(() => setSupported(ctor() !== null), []);

  const clearSilence = () => {
    if (silenceRef.current !== null) {
      window.clearTimeout(silenceRef.current);
      silenceRef.current = null;
    }
  };

  const stop = useCallback(() => {
    clearSilence();
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = ctor();
    if (!Ctor) return;

    // Tapping twice must not open a second session against the same mic.
    recRef.current?.abort();

    const rec = new Ctor();
    rec.lang = "en-US";
    /*
     * continuous, not one-shot.
     *
     * A trading sentence has pauses in it — "buy $500 of sol… sell a third at
     * 2x… stop the rest at -50%". One-shot recognition ends at the first
     * pause and silently truncates the order to its first clause, which is
     * the most dangerous possible failure: a valid, parseable, WRONG order.
     * So it listens through the gaps and ends on a real silence instead.
     */
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    finalRef.current = "";
    setTranscript("");
    setInterim("");
    setError(null);

    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else live += r[0].transcript;
      }
      setTranscript(finalRef.current);
      setInterim(live);

      // Any speech resets the clock; the pause has to be a real one.
      clearSilence();
      silenceRef.current = window.setTimeout(stop, SILENCE_MS);
    };

    rec.onerror = (e) => {
      const msg = MESSAGES[e.error];
      // "aborted" is what our own stop() looks like. Not an error.
      if (msg) setError(msg);
      else if (msg !== "") setError("The microphone stopped unexpectedly.");
    };

    rec.onend = () => {
      clearSilence();
      setListening(false);
      setInterim("");
      const heard = finalRef.current.trim();
      const session = sessionRef.current;
      const mr = mediaRef.current;

      /* No recording — unsupported browser, or the mic was refused. The
         browser's text is used exactly as it always was. */
      if (!mr || mr.state === "inactive") {
        releaseMic();
        if (heard) cbRef.current?.(heard);
        return;
      }

      mr.onstop = async () => {
        releaseMic();
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        chunksRef.current = [];
        const authoritative = await transcribe(blob, keytermsRef.current?.() ?? []);
        /* A newer session has started while this one was being transcribed:
           drop it rather than fire an order nobody is speaking. */
        if (session !== sessionRef.current) return;
        const text = authoritative || heard;
        if (!text) return;
        setTranscript(text);
        cbRef.current?.(text);
      };
      mr.stop();
    };

    recRef.current = rec;
    sessionRef.current += 1;
    /* A previous session's recorder must not keep the mic open. */
    if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop();
    mediaRef.current = null;
    releaseMic();

    /*
     * Record the same audio in parallel. The browser recogniser keeps running
     * for the live words on screen — instant, free, already written — and this
     * clip is what gets the authoritative transcript when speech ends.
     *
     * Fire-and-forget: if getUserMedia is slow or refused, the session simply
     * has no recording and falls back to the browser's text in onend.
     */
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const mr = new MediaRecorder(stream);
        chunksRef.current = [];
        mr.ondataavailable = (e) => {
          if (e.data.size) chunksRef.current.push(e.data);
        };
        mediaRef.current = mr;
        mr.start();
      } catch {
        /* No recorder: the browser's text is used, exactly as before. */
      }
    })();

    try {
      rec.start();
      setListening(true);
    } catch {
      /* start() throws if a session is already running — rare, and abort()
         above usually prevents it. Nothing useful to say to the user. */
      setListening(false);
    }
  }, [stop]);

  // Never leave a microphone open behind a navigation.
  useEffect(() => {
    return () => {
      clearSilence();
      recRef.current?.abort();
      sessionRef.current += 1;
      if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { supported, listening, transcript, interim, error, start, stop };
}
