"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dictation, via Deepgram and nothing else.
 *
 * THE BROWSER'S RECOGNISER IS GONE. The user's call, 24 Sep 2026: "only
 * Deepgram". It used to run alongside — Chrome's Web Speech API live as you
 * spoke, a recorded clip to Deepgram when you stopped, and `authoritative ||
 * heard` picking whichever answered. That had one virtue and two faults.
 *
 * The virtue: words appeared while you talked. They no longer do; the bar says
 * it is listening, then the finished sentence arrives. Deepgram has a
 * streaming socket that would give the live text back, and that is the upgrade
 * when it earns one. It is deliberately not this change.
 *
 * The faults were worse. Chrome ships the audio to Google, which is a second
 * vendor nobody chose and a privacy claim cipher cannot make. And the fallback
 * was SILENT — a Deepgram timeout, a 401, a slow network, and you quietly got
 * Chrome's transcript instead, with nothing on screen to say so. Two engines
 * and no way to tell which answered means no way to judge either. cipher spent
 * weeks blaming Deepgram for text Chrome produced.
 *
 * ONE ENGINE MEANS FAILURES ARE LOUD. Nothing falls back, so anything that
 * goes wrong says so. That is the point: a voice bar that silently degrades is
 * a voice bar you cannot improve.
 *
 * It also works in Firefox now, which never had the Web Speech API at all —
 * MediaRecorder and getUserMedia are everywhere.
 *
 * Requires a secure context. localhost counts; production is HTTPS anyway.
 */

/**
 * NOTHING WAITS FOR SILENCE. The user's call, 24 Sep 2026: "as soon as we stop
 * talking and hit Enter, directly Deepgram comes. There should not be any
 * silence timer."
 *
 * A pause detector cost 1.8 seconds on every sentence — longer than the
 * transcription it was waiting to start — and it guessed. It cut people off
 * mid-thought when they paused to think, and sat there when a room was noisy.
 * Enter knows exactly when somebody has finished, because they pressed it.
 *
 * Enter now ends the clip and sends it. A second Enter places the order, once
 * the words are on screen and have been read — which is the rule the bar
 * already followed for speech.
 */

/** A stuck microphone must not record until the tab is closed. */
const MAX_CLIP_MS = 60_000;

/**
 * Longer than the old six seconds, because there is nothing behind it now.
 *
 * With a fallback, a timeout cost you accuracy. Without one it costs you the
 * whole sentence, so it is worth waiting through a slow response rather than
 * throwing away words somebody already said.
 */
const TRANSCRIBE_TIMEOUT_MS = 15_000;

export interface Speech {
  /** False without a microphone API, in insecure contexts, and during SSR. */
  supported: boolean;
  /** The microphone is open and recording. */
  listening: boolean;
  /** The clip has been sent and the answer has not come back. */
  transcribing: boolean;
  /** The finished sentence. Empty until Deepgram answers. */
  transcript: string;
  /**
   * Always empty.
   *
   * Kept so the bar's contract does not change while the live-text question is
   * open. Deepgram's streaming socket would fill it; the clip API cannot.
   */
  interim: string;
  error: string | null;
  /** How long the last transcription took, end of speech to text. */
  lastMs: number | null;
  /**
   * Deepgram's share of that, in ms. The remainder is the network.
   *
   * Two costs hide inside one number — the trip from a browser to the
   * function and back, and the vendor's own processing — and they are fixed
   * by completely different things. A faster model does nothing about the
   * ocean; a nearer region does nothing about a slow model.
   */
  lastVendorMs: number | null;
  start(): void;
  stop(): void;
}

const MIC_ERRORS: Record<string, string> = {
  NotAllowedError: "Your browser is blocking the microphone. Allow it in the address bar and tap again.",
  SecurityError: "Your browser is blocking the microphone. Allow it in the address bar and tap again.",
  NotFoundError: "No microphone found.",
  NotReadableError: "Something else is using the microphone.",
};

/**
 * Send the clip and return what Deepgram heard.
 *
 * THROWS rather than returning "". Nothing falls back any more, so a failure
 * is a failure and the user has to be told — the old version swallowed every
 * one of these and handed back Chrome's guess.
 */
async function transcribe(blob: Blob, keyterms: string[]): Promise<{ text: string; vendorMs: number | null }> {
  if (blob.size === 0) throw new Error("Nothing was recorded. Check the microphone and try again.");

  const q = keyterms.length ? `?keyterms=${encodeURIComponent(keyterms.join(","))}` : "";
  let res: Response;
  try {
    res = await fetch(`/api/transcribe${q}`, {
      method: "POST",
      headers: { "Content-Type": blob.type || "audio/webm" },
      body: blob,
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Couldn't reach the transcriber. Type it instead.");
  }

  if (res.status === 401 || res.status === 403) throw new Error("Voice isn't configured. Type it instead.");
  if (res.status === 429) throw new Error("Too many voice requests. Wait a moment.");
  if (!res.ok) throw new Error("The transcriber failed. Type it instead.");

  const body = (await res.json().catch(() => ({}))) as { transcript?: unknown; vendorMs?: unknown };
  const text = typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!text) throw new Error("I didn't catch that. Say it again.");
  return { text, vendorMs: typeof body.vendorMs === "number" ? body.vendorMs : null };
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
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [lastVendorMs, setLastVendorMs] = useState<number | null>(null);

  /* Callbacks through refs: `start` and `stop` are handed to a button and must
     stay referentially stable, so what they read cannot be state. */
  const cbRef = useRef(onFinal);
  cbRef.current = onFinal;
  const keytermsRef = useRef(getKeyterms);
  keytermsRef.current = getKeyterms;

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timersRef = useRef<{ cap?: number }>({});
  /** Bumped per session, so a late answer from an abandoned clip is dropped. */
  const sessionRef = useRef(0);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        typeof MediaRecorder !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia),
    );
  }, []);

  const teardown = useCallback(() => {
    const t = timersRef.current;
    if (t.cap) window.clearTimeout(t.cap);
    timersRef.current = {};
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else {
      teardown();
      setListening(false);
    }
  }, [teardown]);

  const start = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") return;
    setError(null);
    setTranscript("");
    const session = ++sessionRef.current;

    /*
     * WARM THE CONNECTION WHILE THEY TALK.
     *
     * The clip is not ready until they let go, but the socket to carry it can
     * be. An idle HTTP/2 connection is closed after a minute or two, so the
     * first order of a session — and every one after a pause — paid for DNS,
     * TCP and TLS before a byte of audio moved. Measured from Mumbai that
     * handshake alone is around 300ms, which is a third of the whole wait and
     * is spent doing nothing.
     *
     * Fired and forgotten on purpose: it exists for its side effect on the
     * connection pool, and a failure here must never reach the microphone.
     */
    void fetch("/api/transcribe", { method: "HEAD" }).catch(() => {});

    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((stream) => {
        if (session !== sessionRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        chunksRef.current = [];

        /*
         * 24 kbps mono opus. The default is several times this and speech
         * does not use it — the words are identical and the upload is a
         * fraction of the size, which is the one part of the round trip that
         * scales with how long somebody talked.
         */
        const rec = new MediaRecorder(stream, { audioBitsPerSecond: 24_000 });
        recorderRef.current = rec;
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        rec.onstop = async () => {
          teardown();
          setListening(false);
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
          chunksRef.current = [];
          if (session !== sessionRef.current) return;

          setTranscribing(true);
          const began = performance.now();
          try {
            const { text, vendorMs } = await transcribe(blob, keytermsRef.current?.() ?? []);
            /* A newer session started while this one was in flight: drop it
               rather than fire an order nobody is currently speaking. */
            if (session !== sessionRef.current) return;
            setLastMs(Math.round(performance.now() - began));
            setLastVendorMs(vendorMs);
            setTranscript(text);
            cbRef.current?.(text);
          } catch (e) {
            if (session !== sessionRef.current) return;
            setLastMs(Math.round(performance.now() - began));
            setError((e as Error).message);
          } finally {
            if (session === sessionRef.current) setTranscribing(false);
          }
        };

        /* A stuck microphone must not record until the tab is closed. */
        timersRef.current.cap = window.setTimeout(stop, MAX_CLIP_MS);

        rec.start();
        setListening(true);
      })
      .catch((e: DOMException) => {
        teardown();
        setListening(false);
        setError(MIC_ERRORS[e.name] ?? "The microphone could not be opened.");
      });
  }, [stop, teardown]);

  useEffect(() => teardown, [teardown]);

  return {
    supported,
    listening,
    transcribing,
    transcript,
    interim: "",
    error,
    lastMs,
    lastVendorMs,
    start,
    stop,
  };
}
