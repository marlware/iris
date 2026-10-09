import type { Request, Response, NextFunction } from "express";
import { createReadStream, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Fault-injecting file server. The fault spec lives in the URL path so it carries over
// to the relative segment URLs inside the playlist:
//
//   /chaos/<spec>/<token>/basic/index.m3u8
//
// spec is comma separated:
//   delay=400                    add 400ms to every response
//   bw=300                       cap throughput at 300 kbps
//   drop=6000:300                after 6s (from the token's first request) cap at 300 kbps
//   outage=4000:12000            between 4s and 16s, drop every connection (like a lost network)
//   fail=seg_003.ts:503          always answer 503 for that file
//   fail=seg_003.ts:503:2        answer 503 for the first 2 requests, then serve normally
//
// token scopes the "first N requests" counters, so each test run passes a fresh one.

interface Rule { file: string; status: number; times: number }
interface Spec { delayMs: number; bwKbps: number; drop: { afterMs: number; kbps: number } | null; outage: { startMs: number; lenMs: number } | null; rules: Rule[] }

const hits = new Map<string, number>();
const starts = new Map<string, number>();

export function parseSpec(raw: string): Spec {
  const spec: Spec = { delayMs: 0, bwKbps: 0, drop: null, outage: null, rules: [] };
  for (const part of raw.split(",")) {
    const [key, val = ""] = part.split("=");
    if (key === "delay") spec.delayMs = Number(val);
    else if (key === "bw") spec.bwKbps = Number(val);
    else if (key === "outage") {
      const [startMs, lenMs] = val.split(":");
      spec.outage = { startMs: Number(startMs), lenMs: Number(lenMs) };
    } else if (key === "drop") {
      const [afterMs, kbps] = val.split(":");
      spec.drop = { afterMs: Number(afterMs), kbps: Number(kbps) };
    } else if (key === "fail") {
      const [file, status, times] = val.split(":");
      spec.rules.push({ file, status: Number(status), times: times ? Number(times) : Infinity });
    }
  }
  return spec;
}

const MIME: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".m4s": "video/iso.segment",
  ".mp4": "video/mp4",
};

export function chaos(root: string) {
  return (req: Request, res: Response, _next: NextFunction) => {
    const spec = parseSpec(req.params.spec);
    const rel = path.normalize(req.path).replace(/^([/\\])+/, "");
    const file = path.join(root, rel);
    if (!file.startsWith(root)) return void res.sendStatus(403);

    let size: number;
    try { size = statSync(file).size; } catch { return void res.sendStatus(404); }

    if (!starts.has(req.params.token)) starts.set(req.params.token, Date.now());
    const elapsed = Date.now() - starts.get(req.params.token)!;
    if (spec.outage && elapsed >= spec.outage.startMs && elapsed < spec.outage.startMs + spec.outage.lenMs) {
      return void req.socket.destroy();
    }
    const bwKbps = spec.drop && elapsed >= spec.drop.afterMs ? spec.drop.kbps : spec.bwKbps;

    const name = path.basename(file);
    const key = `${req.params.token}:${name}`;
    const n = (hits.get(key) ?? 0) + 1;
    hits.set(key, n);
    const rule = spec.rules.find((r) => r.file === name && n <= r.times);

    setTimeout(() => {
      if (rule) return void res.sendStatus(rule.status);
      res.setHeader("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
      res.setHeader("Content-Length", size);
      res.setHeader("Cache-Control", "no-store");
      if (!bwKbps) return void createReadStream(file).pipe(res);

      // throttle: every 50ms send whatever the byte budget allows for the time elapsed
      const buf = readFileSync(file);
      const bytesPerMs = (bwKbps * 1000) / 8 / 1000;
      const start = Date.now();
      let sent = 0;
      const tick = setInterval(() => {
        const allowed = Math.min(buf.length, Math.floor((Date.now() - start) * bytesPerMs));
        if (allowed > sent) { res.write(buf.subarray(sent, allowed)); sent = allowed; }
        if (sent >= buf.length) { clearInterval(tick); res.end(); }
      }, 50);
      res.once("close", () => clearInterval(tick));
    }, spec.delayMs);
  };
}
