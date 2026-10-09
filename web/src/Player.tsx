import { useEffect, useRef } from "react";
import { instrument } from "./instrument";

export function Player() {
  const ref = useRef<HTMLVideoElement>(null);
  const q = new URLSearchParams(location.search);
  const src = q.get("src") ?? "/streams/basic/index.m3u8";
  const retries = q.has("retries") ? Number(q.get("retries")) : undefined;
  const retryDelayMs = q.has("retryDelay") ? Number(q.get("retryDelay")) : undefined;

  useEffect(() => (ref.current ? instrument(ref.current, src, { retries, retryDelayMs }) : undefined), [src, retries, retryDelayMs]);

  return <video ref={ref} muted playsInline controls width={640} height={360} data-testid="video" />;
}
