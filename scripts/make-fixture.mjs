// Builds the HLS test streams under fixtures/. ffmpeg is only here to make fixtures;
// Iris itself just plays streams.
//   basic: one rendition, 30s test pattern + tone, H.264/AAC, 2s segments
//   abr:   same content as a 3-rung ladder (180p/360p/540p) behind a master playlist
import ffmpeg from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const run = (args) => execFileSync(ffmpeg, ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
const src = (size) => ["-f", "lavfi", "-i", `testsrc2=duration=30:size=${size}:rate=30`];
const tone = ["-f", "lavfi", "-i", "sine=frequency=440:duration=30"];
const h264 = ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0"];

// basic
rmSync("fixtures/basic", { recursive: true, force: true });
mkdirSync("fixtures/basic", { recursive: true });
run([
  ...src("640x360"), ...tone, ...h264,
  "-c:a", "aac", "-b:a", "64k",
  "-f", "hls", "-hls_time", "2", "-hls_playlist_type", "vod",
  "-hls_segment_filename", "fixtures/basic/seg_%03d.ts",
  "fixtures/basic/index.m3u8",
]);

// abr
rmSync("fixtures/abr", { recursive: true, force: true });
for (const i of [0, 1, 2]) mkdirSync(`fixtures/abr/v${i}`, { recursive: true });
const ladder = [
  { size: "320x180", kbps: 250 },
  { size: "640x360", kbps: 800 },
  { size: "960x540", kbps: 1600 },
];
const scales = ladder.map((r, i) => `[s${i}]scale=${r.size.replace("x", ":")}[v${i}]`).join(";");
const rungs = ladder.flatMap((r, i) => [
  "-map", `[v${i}]`, `-b:v:${i}`, `${r.kbps}k`, `-maxrate:v:${i}`, `${Math.round(r.kbps * 1.1)}k`, `-bufsize:v:${i}`, `${r.kbps * 2}k`,
]);
run([
  ...src("960x540"), ...tone,
  "-filter_complex", `[0:v]split=3[s0][s1][s2];${scales}`,
  ...rungs,
  ...ladder.flatMap(() => ["-map", "1:a"]),
  ...h264.slice(0, 6), "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
  "-c:a", "aac", "-b:a", "64k",
  "-var_stream_map", "v:0,a:0 v:1,a:1 v:2,a:2",
  "-master_pl_name", "master.m3u8",
  "-f", "hls", "-hls_time", "2", "-hls_playlist_type", "vod",
  "-hls_segment_filename", "fixtures/abr/v%v/seg_%03d.ts",
  "fixtures/abr/v%v/index.m3u8",
]);
console.log("fixtures written to fixtures/");
