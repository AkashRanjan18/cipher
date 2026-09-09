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

export function useSpeech(onFinal?: (text: string) => void): Speech {
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
      const text = finalRef.current.trim();
      if (text) cbRef.current?.(text);
    };

    recRef.current = rec;
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
    };
  }, []);

  return { supported, listening, transcript, interim, error, start, stop };
}
