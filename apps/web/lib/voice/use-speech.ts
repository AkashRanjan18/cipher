"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dictation via Deepgram, STREAMED while the user speaks.
 *
 * HOW IT WORKS. Holding Ctrl opens the microphone and, at the same moment, a
 * socket straight to Deepgram. Audio goes up in 100ms pieces as it is spoken,
 * and Deepgram sends words back as it hears them — so the bar fills while the
 * sentence is still being said. Letting go of Ctrl closes the stream, and by
 * then almost everything has already been transcribed; what is left is the
 * last fragment of sound.
 *
 * WHY. The clip design did nothing during the sentence and everything after
 * it: measured on a real spoken order, 24 Sep 2026, 1.0s from release to
 * text — 923ms of it Deepgram, work that could only begin once the whole
 * clip had arrived. Streaming moves that work into the seconds the user was
 * already spending talking.
 *
 * DIRECT TO DEEPGRAM, NOT THROUGH CIPHER. Vercel's functions answer one
 * request and end, and cannot hold a socket open for a sentence, so the
 * browser connects to Deepgram itself with a sixty-second pass minted by
 * /api/voice/token (lib/voice/token.ts has the full reasoning). cipher's
 * servers never see the audio at all on this path.
 *
 * THE CLIP IS KEPT AS THE FALLBACK. A socket can drop mid-sentence, a token
 * can fail to mint, a network can refuse the upgrade — and a stream that dies
 * leaves nothing on disk to retry with. So a MediaRecorder records the same
 * audio locally, in parallel, and is uploaded to /api/transcribe ONLY if the
 * stream failed. It costs nothing when unused: nothing leaves the browser.
 *
 * Deepgram only ever hears the seconds Ctrl is held. The socket opens on
 * Ctrl-down and closes on Ctrl-up, which is also what keeps streaming cheap —
 * Deepgram bills for how long the socket is OPEN, and an always-listening
 * microphone would bill for the whole session.
 *
 * Requires a secure context. localhost counts; production is HTTPS anyway.
 */

/** A stuck microphone must not record until the tab is closed. */
const MAX_CLIP_MS = 60_000;

/**
 * How long to wait for Deepgram's last words after the stream is closed.
 *
 * Deepgram sends its final results and then closes the socket itself. This is
 * the ceiling on waiting for that, after which whatever has arrived is used —
 * a lost trailing word is better than a bar that hangs.
 */
const FINAL_TIMEOUT_MS = 2_500;

/**
 * How long a released sentence waits for a socket that is still opening.
 *
 * Opening measured ~830ms from Mumbai; a stale pass adds a mint on top. Three
 * seconds covers both with room, and past it the clip is the faster answer.
 */
const OPEN_TIMEOUT_MS = 3_000;

/** The fallback's ceiling. Nothing falls back from IT, so it may wait. */
const TRANSCRIBE_TIMEOUT_MS = 15_000;

/**
 * 16kHz mono. Speech carries nothing above 8kHz that transcription uses, and
 * a third of 48kHz is a third of the bytes on every 100ms chunk.
 */
const SAMPLE_RATE = 16_000;

export interface Speech {
  /** False without a microphone API, in insecure contexts, and during SSR. */
  supported: boolean;
  /** The microphone is open and recording. */
  listening: boolean;
  /** Released, and the last words have not come back yet. */
  transcribing: boolean;
  /** Words Deepgram has settled on so far. Grows while the user speaks. */
  transcript: string;
  /** Words it is still revising. Shown so the bar visibly keeps up. */
  interim: string;
  error: string | null;
  /** How long from releasing Ctrl to having the text, in ms. */
  lastMs: number | null;
  /**
   * Which path answered the last sentence.
   *
   * "stream" is the normal case. "clip" means the socket failed and the
   * recording was uploaded instead — worth seeing, because a clip answer that
   * takes a second is the fallback working, not the stream being slow.
   */
  lastPath: "stream" | "clip" | null;
  /**
   * Why the stream did not answer the last sentence, when it did not.
   *
   * "Stream failed" alone was wrong in the one case that mattered: a socket
   * still OPENING when the key was released is not a failure. The reason
   * separates a slow handshake, a refused token and a dropped connection,
   * which are fixed by three different things.
   */
  lastFailure: string | null;
  start(): void;
  stop(): void;
  /**
   * Stop recording and throw the sentence away.
   *
   * Holding Control starts the microphone, and Control is also the first half
   * of Ctrl+C, Ctrl+R and every other shortcut — so the moment a second key
   * joins it, the intent was never to speak and nothing must be transcribed,
   * charged for, or dropped into the bar.
   */
  cancel(): void;
}

const MIC_ERRORS: Record<string, string> = {
  NotAllowedError: "Your browser is blocking the microphone. Allow it in the address bar and try again.",
  SecurityError: "Your browser is blocking the microphone. Allow it in the address bar and try again.",
  NotFoundError: "No microphone found.",
  NotReadableError: "Something else is using the microphone.",
};

/* ───────────────────────────── the voice pass ──────────────────────────── */

let cachedToken: { token: string; expires: number } | null = null;
let tokenInFlight: Promise<string> | null = null;

/**
 * A pass that is valid for at least another ten seconds.
 *
 * Tokens cost nothing to hold — Deepgram bills the socket, not the pass — so
 * one is minted ahead of time and reused until it is close to expiry. That
 * takes the mint off the path between pressing Ctrl and the socket opening.
 * A token is only checked when a socket OPENS, so ten seconds of margin is
 * plenty; the sentence itself can outlive it.
 */
async function voiceToken(): Promise<string> {
  if (cachedToken && cachedToken.expires - Date.now() > 10_000) return cachedToken.token;
  tokenInFlight ??= fetch("/api/voice/token", { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) throw new Error(`voice token ${res.status}`);
      const body = (await res.json()) as { token: string; expiresIn: number };
      cachedToken = { token: body.token, expires: Date.now() + body.expiresIn * 1_000 };
      return body.token;
    })
    .finally(() => {
      tokenInFlight = null;
    });
  return tokenInFlight;
}

/** Get a pass ready before it is needed. Failure is silent: start() will ask again. */
export function prefetchVoiceToken(): void {
  void voiceToken().catch(() => {});
}

/* ─────────────────────────── the audio pipeline ────────────────────────── */

/**
 * Runs on the audio thread: gathers samples into 100ms chunks and posts them.
 *
 * A WORKLET rather than ScriptProcessorNode, which is deprecated and runs on
 * the main thread — where a busy chart repaint would drop audio. Batching to
 * 100ms keeps the socket at ten messages a second rather than a hundred and
 * twenty-five.
 */
const WORKLET = `
class Pcm extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.size = Math.round(sampleRate / 10); }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) this.buf.push(ch[i]);
      if (this.buf.length >= this.size) {
        this.port.postMessage(Float32Array.from(this.buf));
        this.buf = [];
      }
    }
    return true;
  }
}
registerProcessor("pcm", Pcm);
`;

/** Float samples in [-1, 1] to signed 16-bit PCM, which is what Deepgram reads. */
function toPcm16(samples: Float32Array): ArrayBuffer {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

/**
 * The socket's address.
 *
 * PLAIN WORDS, NO FORMATTING — the same settings as the clip route, and for
 * the same reason: with smart_format on, "sell half" came back as "sell 0.5",
 * which reads as half of ONE coin rather than half the position. Numbers are
 * normalise.ts's job, where they are tested.
 */
function socketUrl(sampleRate: number, keyterms: string[]): string {
  const p = new URLSearchParams({
    model: "nova-3",
    language: "en",
    encoding: "linear16",
    sample_rate: String(sampleRate),
    channels: "1",
    interim_results: "true",
    smart_format: "false",
    punctuate: "false",
    numerals: "false",
  });
  for (const t of keyterms.slice(0, 60)) {
    if (/^[A-Za-z0-9 .$-]{1,32}$/.test(t)) p.append("keyterm", t);
  }
  return `wss://api.deepgram.com/v1/listen?${p}`;
}

/** The fallback: upload the local recording, exactly as before streaming. */
async function transcribeClip(blob: Blob, keyterms: string[]): Promise<string> {
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
  if (res.status === 429) throw new Error("Too many voice requests. Wait a moment.");
  if (!res.ok) throw new Error("The transcriber failed. Type it instead.");
  const body = (await res.json().catch(() => ({}))) as { transcript?: unknown };
  return typeof body.transcript === "string" ? body.transcript.trim() : "";
}

/* ──────────────────────────────── the hook ─────────────────────────────── */

interface Session {
  id: number;
  stream: MediaStream;
  audio: AudioContext;
  socket: WebSocket | null;
  /** Audio captured before the socket opened — sent the moment it does. */
  queued: ArrayBuffer[];
  /** Words Deepgram has marked final. */
  finals: string[];
  interim: string;
  /** Set once the socket has failed; the clip answers instead. */
  streamFailed: boolean;
  /** Why the stream did not answer, when it did not — shown under the bar. */
  failure: string | null;
  /**
   * Resolves true when the socket opens, false if it never will.
   *
   * RELEASE CAN BEAT THE SOCKET. Opening takes ~830ms from Mumbai, plus a
   * mint when the cached pass has gone stale, and a short order is often said
   * and released faster than that. The first version treated a socket that was
   * still CONNECTING as failed and uploaded the clip instead — reported live,
   * 24 Sep 2026, as "clip (stream failed) · 547ms". Nothing had failed: every
   * word was sitting in `queued`, waiting for a socket that was about to open.
   */
  ready: Promise<boolean>;
  /** Resolves when Deepgram closes the socket after its last words. */
  closed: Promise<void>;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  cap: number;
}

export function useSpeech(
  onFinal?: (text: string) => void,
  /**
   * The coins worth listening for — the open market, the list on screen, what
   * the user holds. A getter so it is read when the socket opens, not frozen
   * at the render that mounted the bar.
   */
  getKeyterms?: () => string[],
): Speech {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [lastPath, setLastPath] = useState<"stream" | "clip" | null>(null);
  const [lastFailure, setLastFailure] = useState<string | null>(null);

  /* Refs, not state: start/stop/cancel are handed to key listeners bound once,
     and anything they read from state would be frozen at the first render. */
  const cbRef = useRef(onFinal);
  cbRef.current = onFinal;
  const keytermsRef = useRef(getKeyterms);
  keytermsRef.current = getKeyterms;
  const sessionRef = useRef<Session | null>(null);
  const counterRef = useRef(0);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        typeof AudioWorkletNode !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia),
    );
    /* A pass ready before the first Ctrl, so the mint is never on the path. */
    prefetchVoiceToken();
  }, []);

  /** Release the microphone and the audio graph. Leaves the socket alone. */
  const releaseMic = useCallback((s: Session) => {
    window.clearTimeout(s.cap);
    s.stream.getTracks().forEach((t) => t.stop());
    s.audio.close().catch(() => {});
  }, []);

  const cancel = useCallback(() => {
    const s = sessionRef.current;
    sessionRef.current = null;
    counterRef.current += 1;
    if (!s) return;
    releaseMic(s);
    if (s.recorder && s.recorder.state !== "inactive") s.recorder.stop();
    s.socket?.close(1000);
    setListening(false);
    setTranscribing(false);
    setTranscript("");
    setInterim("");
  }, [releaseMic]);

  const stop = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    sessionRef.current = null;
    const releasedAt = performance.now();

    releaseMic(s);
    setListening(false);
    setTranscribing(true);

    /* The local recording has to be finalised before it can be read, which is
       asynchronous — so this is a promise even though it is usually unused. */
    const clip = new Promise<Blob>((resolve) => {
      const r = s.recorder;
      if (!r || r.state === "inactive") return resolve(new Blob(s.chunks));
      r.onstop = () => resolve(new Blob(s.chunks, { type: r.mimeType || "audio/webm" }));
      r.stop();
    });

    void (async () => {
      let text = "";
      let path: "stream" | "clip" = "stream";

      /* Wait for the socket if it is still opening. `onopen` flushes the
         queued audio the moment it connects, so nothing said before the
         socket was ready is lost — it just arrives a little later. */
      const open = await Promise.race([
        s.ready,
        new Promise<boolean>((r) => setTimeout(() => r(false), OPEN_TIMEOUT_MS)),
      ]);
      if (!open && !s.failure) s.failure = "socket did not open in time";

      if (open && !s.streamFailed && s.socket?.readyState === WebSocket.OPEN) {
        /* Tell Deepgram the sentence is over. It flushes its last words as
           final results and then closes the socket itself. */
        s.socket.send(JSON.stringify({ type: "CloseStream" }));
        await Promise.race([s.closed, new Promise((r) => setTimeout(r, FINAL_TIMEOUT_MS))]);
        text = [...s.finals, s.interim].join(" ").replace(/\s+/g, " ").trim();
        if (!text && !s.failure) s.failure = "stream heard no words";
      }

      /* THE FALLBACK. The socket never opened, dropped part-way, or heard
         nothing — so the local recording, which has every word, goes up the
         old way. */
      if (s.streamFailed || !text) {
        s.socket?.close(1000);
        path = "clip";
        try {
          text = await transcribeClip(await clip, keytermsRef.current?.() ?? []);
        } catch (e) {
          if (s.id === counterRef.current) {
            setError((e as Error).message);
            setTranscribing(false);
          }
          return;
        }
      }

      /* A newer session began while this one was finishing: drop it rather
         than put an old sentence into a bar somebody is speaking into again. */
      if (s.id !== counterRef.current) return;

      setLastMs(Math.round(performance.now() - releasedAt));
      setLastPath(path);
      setLastFailure(path === "clip" ? (s.failure ?? "unknown") : null);
      setTranscribing(false);
      setInterim("");
      if (!text) {
        setError("I didn't catch that. Say it again.");
        return;
      }
      setTranscript(text);
      cbRef.current?.(text);
    })();
  }, [releaseMic]);

  const start = useCallback(() => {
    if (sessionRef.current) return;
    setError(null);
    setTranscript("");
    setInterim("");
    const id = ++counterRef.current;

    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
      .then(async (stream) => {
        if (id !== counterRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        /* The pass is fetched NOW, in parallel with loading the audio worklet
           below, rather than after it. Both are on the path to an open socket,
           and there is no reason for one to wait on the other. */
        const tokenPromise = voiceToken();

        const audio = new AudioContext({ sampleRate: SAMPLE_RATE });
        /* A context created after an await can start SUSPENDED under the
           browser's autoplay rules, and a suspended context feeds the worklet
           nothing — Deepgram would hear silence and the stream would come back
           empty. Resuming is harmless when it is already running. */
        if (audio.state === "suspended") await audio.resume().catch(() => {});
        let resolveClosed = () => {};
        let resolveReady: (ok: boolean) => void = () => {};
        const s: Session = {
          id,
          stream,
          audio,
          socket: null,
          queued: [],
          finals: [],
          interim: "",
          streamFailed: false,
          failure: null,
          ready: new Promise<boolean>((r) => {
            resolveReady = r;
          }),
          closed: new Promise<void>((r) => {
            resolveClosed = r;
          }),
          recorder: null,
          chunks: [],
          cap: window.setTimeout(() => stop(), MAX_CLIP_MS),
        };
        sessionRef.current = s;
        setListening(true);

        /* The fallback recording, local only. Nothing is uploaded unless the
           stream fails, so in the normal case it costs nothing at all. */
        try {
          const rec = new MediaRecorder(stream, { audioBitsPerSecond: 24_000 });
          rec.ondataavailable = (e) => {
            if (e.data.size > 0) s.chunks.push(e.data);
          };
          rec.start();
          s.recorder = rec;
        } catch {
          /* No MediaRecorder means no fallback, not no voice. */
        }

        /*
         * CAPTURE STARTS NOW, before the socket exists. Opening it takes about
         * three quarters of a second from Mumbai (measured, 24 Sep 2026), and
         * the user is already talking — so every chunk goes into `queued`
         * until the socket is open, then out in order. Without this the first
         * word or two of every sentence is simply lost.
         */
        const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
        await audio.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const node = new AudioWorkletNode(audio, "pcm");
        node.port.onmessage = (e: MessageEvent<Float32Array>) => {
          const pcm = toPcm16(e.data);
          if (s.socket?.readyState === WebSocket.OPEN) s.socket.send(pcm);
          else s.queued.push(pcm);
        };
        audio.createMediaStreamSource(stream).connect(node);

        /* The socket. `bearer`, not `token`: `token` is the scheme for a raw
           API key, and a minted pass sent under it is refused outright —
           verified against the live API, 24 Sep 2026. */
        let token: string;
        try {
          token = await tokenPromise;
        } catch {
          s.streamFailed = true;
          s.failure = "voice token could not be fetched";
          resolveReady(false);
          resolveClosed();
          return;
        }
        if (id !== counterRef.current) {
          resolveReady(false);
          return;
        }

        const socket = new WebSocket(socketUrl(audio.sampleRate, keytermsRef.current?.() ?? []), [
          "bearer",
          token,
        ]);
        socket.binaryType = "arraybuffer";
        s.socket = socket;

        socket.onopen = () => {
          for (const chunk of s.queued) socket.send(chunk);
          s.queued = [];
          resolveReady(true);
        };

        socket.onmessage = (m) => {
          let msg: {
            type?: string;
            is_final?: boolean;
            channel?: { alternatives?: { transcript?: string }[] };
          };
          try {
            msg = JSON.parse(String(m.data));
          } catch {
            return;
          }
          if (msg.type !== "Results") return;
          const words = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
          if (msg.is_final) {
            if (words) s.finals.push(words);
            s.interim = "";
          } else {
            s.interim = words;
          }
          /* Only the live session paints the bar; a closing one is quiet. */
          if (sessionRef.current === s) {
            setTranscript(s.finals.join(" "));
            setInterim(s.interim);
          }
        };

        socket.onerror = () => {
          s.streamFailed = true;
          s.failure ??= "socket error";
          resolveReady(false);
        };
        socket.onclose = (e) => {
          /* 1000 is the clean close Deepgram sends after the last words.
             Anything else while we were still talking is a dropped stream,
             and the clip has to answer. The code is kept, because "1006" and
             "1008" point at completely different causes. */
          if (e.code !== 1000) {
            s.streamFailed = true;
            s.failure ??= `socket closed (${e.code}${e.reason ? `: ${e.reason}` : ""})`;
          }
          resolveReady(false);
          resolveClosed();
        };
      })
      .catch((e: DOMException) => {
        if (id !== counterRef.current) return;
        sessionRef.current = null;
        setListening(false);
        setError(MIC_ERRORS[e.name] ?? "The microphone could not be opened.");
      });
  }, [stop]);

  useEffect(() => () => cancel(), [cancel]);

  return {
    supported,
    listening,
    transcribing,
    transcript,
    interim,
    error,
    lastMs,
    lastPath,
    lastFailure,
    start,
    stop,
    cancel,
  };
}
