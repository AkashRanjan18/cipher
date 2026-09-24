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

/** How long a pause ends the sentence. */
const SILENCE_MS = 1_800;

/**
 * Loud enough to be speech.
 *
 * RMS over the raw waveform, 0-1. Room tone on a laptop mic sits around
 * 0.002-0.008; speech clears 0.02 comfortably. The threshold has to sit above
 * a noisy room and below a quiet voice, and this is the middle of that gap.
 */
const SPEECH_RMS = 0.015;

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
async function transcribe(blob: Blob, keyterms: string[]): Promise<string> {
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

  const body = (await res.json().catch(() => ({}))) as { transcript?: unknown };
  const text = typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!text) throw new Error("I didn't catch that. Say it again.");
  return text;
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

  /* Callbacks through refs: `start` and `stop` are handed to a button and must
     stay referentially stable, so what they read cannot be state. */
  const cbRef = useRef(onFinal);
  cbRef.current = onFinal;
  const keytermsRef = useRef(getKeyterms);
  keytermsRef.current = getKeyterms;

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<AudioContext | null>(null);
  const timersRef = useRef<{ poll?: number; cap?: number }>({});
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
    if (t.poll) window.clearInterval(t.poll);
    if (t.cap) window.clearTimeout(t.cap);
    timersRef.current = {};
    audioRef.current?.close().catch(() => {});
    audioRef.current = null;
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

    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((stream) => {
        if (session !== sessionRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        chunksRef.current = [];

        const rec = new MediaRecorder(stream);
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
            const text = await transcribe(blob, keytermsRef.current?.() ?? []);
            /* A newer session started while this one was in flight: drop it
               rather than fire an order nobody is currently speaking. */
            if (session !== sessionRef.current) return;
            setLastMs(Math.round(performance.now() - began));
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

        /*
         * SILENCE ENDS THE SENTENCE, and it used to be the browser recogniser
         * that noticed. Without it, the level of the audio is the only thing
         * that knows whether anyone is still talking.
         *
         * Speech has to be heard FIRST. Otherwise the pause between tapping
         * the microphone and starting to speak is silence, and the clip ends
         * before a word is in it.
         */
        const audio = new AudioContext();
        audioRef.current = audio;
        const analyser = audio.createAnalyser();
        analyser.fftSize = 1024;
        audio.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);

        let heardSpeech = false;
        let quietSince = 0;
        timersRef.current.poll = window.setInterval(() => {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const s of samples) {
            const v = (s - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / samples.length);

          if (rms > SPEECH_RMS) {
            heardSpeech = true;
            quietSince = 0;
            return;
          }
          if (!heardSpeech) return;
          if (quietSince === 0) quietSince = performance.now();
          else if (performance.now() - quietSince > SILENCE_MS) stop();
        }, 100);

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
    start,
    stop,
  };
}
