"use client";

import { useEffect, useRef } from "react";

/**
 * Falling snow or spring petals on a canvas that fills its parent. The
 * number of particles follows the area (capped), the loop stops in
 * background tabs (requestAnimationFrame does that), and the canvas never
 * takes a click.
 */

type Kind = "snow" | "petals";

type Particle = { x: number; y: number; size: number; speed: number; sway: number; phase: number; spin: number; angle: number; color: string; alpha: number };

const PETALS = ["#f6b8c8", "#fbe29a", "#a9d4f2", "#b9e3b5", "#d3c0f0"];

export function Particles({
  kind,
  density = 1,
  max = 160,
  className,
}: {
  kind: Kind;
  /** Particles per 9,000 px² (1 = a steady snowfall). */
  density?: number;
  max?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let particles: Particle[] = [];

    const make = (anywhere: boolean): Particle => {
      const size = kind === "snow" ? 1.2 + Math.random() * 2.8 : 3 + Math.random() * 3;
      return {
        x: Math.random() * width,
        y: anywhere ? Math.random() * height : -10 - Math.random() * 40,
        size,
        speed: kind === "snow" ? 0.25 + size * 0.28 : 0.35 + Math.random() * 0.45,
        sway: 0.3 + Math.random() * 0.9,
        phase: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.04,
        angle: Math.random() * Math.PI,
        color: kind === "snow" ? "#ffffff" : PETALS[Math.floor(Math.random() * PETALS.length)],
        alpha: kind === "snow" ? 0.7 + Math.random() * 0.3 : 0.75 + Math.random() * 0.25,
      };
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(max, Math.round(((width * height) / 9000) * density));
      particles = Array.from({ length: count }, () => make(true));
      canvas.dataset.particles = String(count);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const step = Math.min(50, now - last) / 16.67; // in 60 fps frames
      last = now;
      ctx.clearRect(0, 0, width, height);
      if (kind === "snow") {
        // A soft grey edge so white flakes still show over white and beige.
        ctx.shadowColor = "rgba(60, 90, 120, 0.6)";
        ctx.shadowBlur = 3;
      }
      for (const p of particles) {
        p.phase += 0.02 * step;
        p.y += p.speed * step;
        p.x += Math.sin(p.phase) * p.sway * 0.5 * step;
        p.angle += p.spin * step;
        if (p.y > height + 10 || p.x < -20 || p.x > width + 20) Object.assign(p, make(false));
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        if (kind === "snow") ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        else ctx.ellipse(p.x, p.y, p.size, p.size * 0.55, p.angle, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [kind, density, max]);

  return <canvas ref={ref} aria-hidden data-particles-kind={kind} className={className} />;
}
