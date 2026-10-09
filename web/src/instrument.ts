import Hls, { Events } from "hls.js";

export interface SeekRecord {
  from: number;
  target: number;
  resumeMs: number | null; // seek issued -> first frame rendered at the new position
  landedAt: number | null; // media time of that frame
}

export interface Rendition { level: number; height: number; bitrate: number }
export interface LevelSwitch { tMs: number; level: number } // tMs since the player started loading

export interface PlaybackMetrics {
  startupMs: number | null; // load start -> first rendered video frame
  stallCount: number; // rebuffer events after playback began
  stallTotalMs: number;
  fatalErrors: number;
  recoveryMs: number | null; // first error -> segments flowing again
  errors: string[];
  segmentsLoaded: number;
  playedSeconds: number;
  ended: boolean;
  seeks: SeekRecord[];
  seekMaxMs: number | null;
  renditions: Rendition[];
  levelSwitches: LevelSwitch[];
}

export interface IrisHandle {
  snapshot(): PlaybackMetrics;
  /** Seek the way a viewer would. Only seeks made through this are recorded; hls.js nudges the start position on its own. */
  seek(t: number): void;
}

declare global {
  interface Window {
    __iris?: IrisHandle;
  }
}

/** Attach hls.js to a <video> and record playback QoE metrics. */
export function instrument(video: HTMLVideoElement, src: string, opts: { retries?: number; retryDelayMs?: number } = {}): () => void {
  const m: PlaybackMetrics = {
    startupMs: null, stallCount: 0, stallTotalMs: 0, fatalErrors: 0, recoveryMs: null,
    errors: [], segmentsLoaded: 0, playedSeconds: 0, ended: false, seeks: [], seekMaxMs: null, renditions: [], levelSwitches: [],
  };
  const t0 = performance.now();
  let stallStart: number | null = null;
  let firstErrorAt: number | null = null;

  video.requestVideoFrameCallback(() => {
    m.startupMs = Math.round(performance.now() - t0);
  });
  // A seek counts as done when a frame near the target is actually on screen.
  let pendingSeek: { rec: SeekRecord; at: number } | null = null;
  let lastTime = 0;
  let userSeek = false;
  const watchSeek = () => {
    video.requestVideoFrameCallback((_now, meta) => {
      if (!pendingSeek) return;
      const { rec, at } = pendingSeek;
      if (!video.seeking && Math.abs(meta.mediaTime - rec.target) < 3) {
        rec.resumeMs = Math.round(performance.now() - at);
        rec.landedAt = Math.round(meta.mediaTime * 100) / 100;
        m.seekMaxMs = Math.max(m.seekMaxMs ?? 0, rec.resumeMs);
        pendingSeek = null;
      } else {
        watchSeek();
      }
    });
  };
  video.addEventListener("timeupdate", () => { if (!video.seeking) lastTime = video.currentTime; });
  video.addEventListener("seeking", () => {
    if (!userSeek) return;
    userSeek = false;
    const rec: SeekRecord = { from: Math.round(lastTime * 100) / 100, target: Math.round(video.currentTime * 100) / 100, resumeMs: null, landedAt: null };
    m.seeks.push(rec);
    pendingSeek = { rec, at: performance.now() };
    watchSeek();
  });
  video.addEventListener("waiting", () => {
    if (m.startupMs !== null && !video.seeking && !pendingSeek && stallStart === null) {
      stallStart = performance.now();
      m.stallCount++;
    }
  });
  video.addEventListener("playing", () => {
    if (stallStart !== null) {
      m.stallTotalMs += Math.round(performance.now() - stallStart);
      stallStart = null;
    }
  });
  video.addEventListener("ended", () => (m.ended = true));

  // Stock hls.js retries for over a minute, which is too slow for a test run.
  const retry = { maxNumRetry: opts.retries ?? 2, retryDelayMs: opts.retryDelayMs ?? 500, maxRetryDelayMs: opts.retryDelayMs ?? 2000 };
  const policy = { default: { maxTimeToFirstByteMs: 8000, maxLoadTimeMs: 20000, timeoutRetry: retry, errorRetry: retry } };
  // Small forward buffer so adaptation decisions happen during playback instead of everything prefetching up front.
  const hls = new Hls({ maxBufferLength: 8, maxMaxBufferLength: 8, fragLoadPolicy: policy, manifestLoadPolicy: policy, playlistLoadPolicy: policy });
  hls.on(Events.FRAG_LOADED, () => {
    m.segmentsLoaded++;
    if (firstErrorAt !== null && m.recoveryMs === null && m.fatalErrors === 0) {
      m.recoveryMs = Math.round(performance.now() - firstErrorAt);
    }
  });
  hls.on(Events.MANIFEST_PARSED, (_e, d) => {
    m.renditions = d.levels.map((l, level) => ({ level, height: l.height, bitrate: l.bitrate }));
  });
  hls.on(Events.LEVEL_SWITCHED, (_e, d) => {
    m.levelSwitches.push({ tMs: Math.round(performance.now() - t0), level: d.level });
  });
  hls.on(Events.ERROR, (_e, data) => {
    firstErrorAt ??= performance.now();
    m.errors.push(`${data.type}/${data.details}${data.fatal ? " (fatal)" : ""}`);
    if (data.fatal) m.fatalErrors++;
  });
  hls.loadSource(src);
  hls.attachMedia(video);
  video.play().catch((e) => m.errors.push(`play() rejected: ${e}`));

  window.__iris = {
    seek: (t) => { userSeek = true; video.currentTime = t; },
    snapshot: () => ({
      ...m,
      stallTotalMs: m.stallTotalMs + (stallStart ? Math.round(performance.now() - stallStart) : 0),
      playedSeconds: Math.round(video.currentTime * 100) / 100,
    }),
  };
  return () => hls.destroy();
}
