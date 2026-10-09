import { useEffect, useRef } from "react";
import { instrument } from "./instrument";

export function Player() {
  const ref = useRef<HTMLVideoElement>(null);
  const src = new URLSearchParams(location.search).get("src") ?? "/streams/basic/index.m3u8";

  useEffect(() => (ref.current ? instrument(ref.current, src) : undefined), [src]);

  return <video ref={ref} muted playsInline controls width={640} height={360} data-testid="video" />;
}
