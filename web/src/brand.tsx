import { useEffect, useRef } from "react";

export function Ink({
  className = "",
  mood = "curious",
}: {
  className?: string;
  mood?: string;
}) {
  return (
    <svg
      className={`ink ${className} ink-${mood}`}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <path
        className="ink-body"
        d="M76 6C43-6 8 15 5 49 1 83 25 99 54 97c28-1 45-17 44-41-1-18-9-21-16-24C66 26 72 15 76 6Z"
      />
      <g className="ink-eyes">
        <ellipse
          cx="56"
          cy="54"
          rx="5.7"
          ry="9.5"
          transform="rotate(-18 56 54)"
        />
        <ellipse
          cx="76"
          cy="45"
          rx="5.1"
          ry="8.8"
          transform="rotate(-18 76 45)"
        />
      </g>
    </svg>
  );
}

export function LivingField({ paused }: { paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const phase = useRef(0);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d", { alpha: true });
    if (!el || !ctx) return;
    let width = 0,
      height = 0,
      frame = 0,
      last = 0;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const observer = new ResizeObserver(() => {
      width = el.clientWidth;
      height = el.clientHeight;
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      el.width = Math.round(width * ratio);
      el.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw(phase.current);
    });
    function draw(time: number) {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      const step = width < 600 ? 10 : 12;
      const t = time * 0.000065;
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const nx = (x - width / 2) / (width * 0.51);
          const ny = (y - height * 0.46) / (height * 0.51);
          const wave =
            Math.sin(x * 0.009 + Math.sin(y * 0.008 + t) * 1.8 + t) * 0.14 +
            Math.cos(y * 0.013 - x * 0.004 - t * 0.7) * 0.12 +
            Math.sin(x * 0.025 + y * 0.018 + t * 0.5) * 0.045;
          const field = nx * nx * 0.91 + ny * ny * 0.88 + wave;
          const protectX = Math.max(
            0,
            Math.abs(x - width / 2) - Math.min(width * 0.32, 410),
          );
          const protectY = Math.max(0, Math.abs(y - height * 0.47) - 210);
          if (protectX < 10 && protectY < 10) continue;
          if (field > 0.93) {
            ctx.fillStyle = "#119df3";
            ctx.fillRect(x, y, step, step);
          } else if (field > 0.76) {
            ctx.fillStyle = "#80ccfa";
            ctx.fillRect(x, y, step, step);
            ctx.fillStyle = "#149df3";
            for (let dy = 0; dy < step; dy += 3)
              for (let dx = 0; dx < step; dx += 3)
                if ((dx + dy) % 2) ctx.fillRect(x + dx, y + dy, 1, 1);
          } else if (field > 0.67) {
            ctx.fillStyle = "#89cefa";
            for (let dy = 0; dy < step; dy += 3)
              for (let dx = 0; dx < step; dx += 3)
                ctx.fillRect(x + dx, y + dy, 1, 1);
          }
        }
      }
    }
    function animate(time: number) {
      if (document.hidden) last = time;
      if (time - last > 80) {
        phase.current += last ? Math.min(time - last, 150) : 0;
        draw(phase.current);
        last = time;
      }
      frame = requestAnimationFrame(animate);
    }
    observer.observe(el);
    if (!paused && !media.matches) frame = requestAnimationFrame(animate);
    const onMotionChange = () => {
      cancelAnimationFrame(frame);
      last = 0;
      if (!paused && !media.matches) frame = requestAnimationFrame(animate);
      else draw(phase.current);
    };
    media.addEventListener("change", onMotionChange);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      media.removeEventListener("change", onMotionChange);
    };
  }, [paused]);
  return <canvas ref={canvas} className="living-field" aria-hidden="true" />;
}
