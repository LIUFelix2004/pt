"use client";

import { useEffect, useRef } from "react";

/**
 * Uniswap-style backdrop: soft blurred circular "token" bubbles drifting slowly.
 * Pure CSS animation + light pointer parallax; no images, no brand logos.
 * Fixed and pointer-events:none, so it never intercepts clicks.
 */
const BUBBLES: { x: number; y: number; s: number; c: [string, string]; l: string; b: number; o: number; d: number; z: number }[] = [
  { x: 6, y: 18, s: 64, c: ["#5b7cfa", "#8fb0ff"], l: "P", b: 0, o: 0.55, d: 13, z: 1 },
  { x: 16, y: 62, s: 44, c: ["#ff7ad9", "#c2268f"], l: "Z", b: 2, o: 0.4, d: 17, z: 0.6 },
  { x: 3, y: 82, s: 80, c: ["#3ddcf5", "#0a7ea4"], l: "H", b: 4, o: 0.35, d: 19, z: 0.4 },
  { x: 24, y: 34, s: 30, c: ["#b4f04a", "#3f8a12"], l: "", b: 3, o: 0.35, d: 15, z: 0.5 },
  { x: 88, y: 14, s: 58, c: ["#f0a35e", "#d1344f"], l: "J", b: 0, o: 0.5, d: 14, z: 1 },
  { x: 78, y: 44, s: 36, c: ["#8b5cf6", "#5b7cfa"], l: "", b: 3, o: 0.38, d: 18, z: 0.5 },
  { x: 92, y: 70, s: 72, c: ["#22c55e", "#0ea5e9"], l: "C", b: 2, o: 0.45, d: 16, z: 0.7 },
  { x: 70, y: 86, s: 40, c: ["#ff8fa3", "#f0a35e"], l: "", b: 5, o: 0.3, d: 21, z: 0.3 },
  { x: 44, y: 8, s: 26, c: ["#3ddcf5", "#5b7cfa"], l: "", b: 4, o: 0.3, d: 20, z: 0.3 },
  { x: 56, y: 92, s: 50, c: ["#5b7cfa", "#ff7ad9"], l: "W", b: 3, o: 0.35, d: 17, z: 0.5 },
  { x: 34, y: 88, s: 22, c: ["#f5c44a", "#f0a35e"], l: "", b: 2, o: 0.35, d: 12, z: 0.8 },
  { x: 64, y: 24, s: 20, c: ["#ff7ad9", "#8b5cf6"], l: "", b: 1, o: 0.35, d: 11, z: 0.9 },
];

export function FloatingBubbles() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const mx = e.clientX / window.innerWidth - 0.5;
        const my = e.clientY / window.innerHeight - 0.5;
        el.querySelectorAll<HTMLElement>(".portus-bubble").forEach((b) => {
          const z = Number(b.dataset.z || 0.5);
          b.style.translate = `${-mx * 24 * z}px ${-my * 24 * z}px`;
        });
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div ref={ref} className="portus-bubbles" aria-hidden>
      {BUBBLES.map((b, i) => (
        <span
          key={i}
          data-z={b.z}
          className="portus-bubble"
          style={
            {
              left: `${b.x}%`,
              top: `${b.y}%`,
              width: b.s,
              height: b.s,
              fontSize: b.s * 0.42,
              background: `radial-gradient(circle at 30% 30%, ${b.c[0]}, ${b.c[1]})`,
              "--b": `${b.b}px`,
              "--o": b.o,
              "--d": `${b.d}s`,
              "--dl": `${-i * 1.7}s`,
              "--dx": `${(i % 2 ? 1 : -1) * (8 + (i % 4) * 4)}px`,
              "--dy": `${(i % 3 ? -1 : 1) * (10 + (i % 5) * 3)}px`,
            } as React.CSSProperties
          }
        >
          {b.l}
        </span>
      ))}
    </div>
  );
}
