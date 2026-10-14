"use client";

/*
 * Derived from the "Beams Background" component in KokonutUI, by @dorianbaffier.
 *   https://kokonutui.com/docs/components/beams-background
 *   https://github.com/kokonut-labs/kokonutui
 *
 * MIT License — Copyright (c) 2025 kokonutUI
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Retaining this notice is the one condition MIT imposes. The copy that reached
 * this repository had the upstream attribution header stripped, so it is
 * restored here rather than left as a silent licence violation.
 */

import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Animated beam backdrop.
 *
 * Adapted from the 21st.dev "beams background" component. The upstream version
 * is a standalone hero — it hardcodes its own dark background and renders demo
 * headline text. Here it is a site-wide backdrop, so the following changed:
 *
 * 1. The demo headline is gone and `children` is actually rendered (upstream
 *    declared the prop but never used it).
 * 2. `fixed` mode paints behind the whole app instead of owning a screen.
 * 3. Hue range is clamped to 190–300 (cyan → violet → magenta). This is not
 *    cosmetic: amber (~40°) is reserved theme-wide for untrusted content and
 *    forfeiture warnings, and a drifting amber glow behind the page would
 *    dilute the one signal that must always win the eye.
 * 4. Reduced motion is honoured — the requestAnimationFrame loop never starts,
 *    and a single static frame is painted instead. A CSS-level
 *    prefers-reduced-motion rule cannot stop a canvas render loop.
 * 5. The loop pauses while the tab is hidden. This dashboard already polls the
 *    API every 10s; a blurred full-screen canvas spinning in a background tab
 *    on top of that is rude.
 * 6. Beam coordinates are generated in CSS pixels, not device pixels. Upstream
 *    seeds positions from `canvas.width` (already multiplied by DPR) while
 *    drawing through a `ctx.scale(dpr, dpr)` transform, so on a 2× display
 *    roughly half the beams sit outside the viewport.
 */

interface BeamsBackgroundProps {
  className?: string;
  children?: React.ReactNode;
  intensity?: "subtle" | "medium" | "strong";
  /** Paint as a fixed, non-interactive layer behind the whole page. */
  fixed?: boolean;
}

interface Beam {
  x: number;
  y: number;
  width: number;
  length: number;
  angle: number;
  speed: number;
  opacity: number;
  hue: number;
  pulse: number;
  pulseSpeed: number;
}

const MINIMUM_BEAMS = 20;

/** Cyan → magenta. Deliberately nowhere near the reserved amber band. */
const HUE_BASE = 190;
const HUE_SPREAD = 110;

const OPACITY_MAP = {
  subtle: 0.42,
  medium: 0.7,
  strong: 1,
} as const;

function createBeam(width: number, height: number): Beam {
  const angle = -35 + Math.random() * 10;
  return {
    x: Math.random() * width * 1.5 - width * 0.25,
    y: Math.random() * height * 1.5 - height * 0.25,
    width: 30 + Math.random() * 60,
    length: height * 2.5,
    angle,
    speed: 0.6 + Math.random() * 1.2,
    opacity: 0.12 + Math.random() * 0.16,
    hue: HUE_BASE + Math.random() * HUE_SPREAD,
    pulse: Math.random() * Math.PI * 2,
    pulseSpeed: 0.02 + Math.random() * 0.03,
  };
}

export function BeamsBackground({
  className,
  children,
  intensity = "subtle",
  fixed = false,
}: BeamsBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const beamsRef = useRef<Beam[]>([]);
  const animationFrameRef = useRef<number>(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Everything below works in CSS pixels; the DPR transform is applied once
    // per resize, after which canvas.width/height are irrelevant to layout.
    let cssWidth = 0;
    let cssHeight = 0;

    const updateCanvasSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2); // 3× costs a lot, buys nothing blurred
      cssWidth = window.innerWidth;
      cssHeight = window.innerHeight;

      canvas.width = cssWidth * dpr;
      canvas.height = cssHeight * dpr;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      // Assigning width/height resets the context, so this scale never stacks.
      ctx.scale(dpr, dpr);

      const totalBeams = Math.round(MINIMUM_BEAMS * 1.5);
      beamsRef.current = Array.from({ length: totalBeams }, () =>
        createBeam(cssWidth, cssHeight),
      );
    };

    updateCanvasSize();
    window.addEventListener("resize", updateCanvasSize);

    function resetBeam(beam: Beam, index: number, totalBeams: number) {
      const column = index % 3;
      const spacing = cssWidth / 3;

      beam.y = cssHeight + 100;
      beam.x = column * spacing + spacing / 2 + (Math.random() - 0.5) * spacing * 0.5;
      beam.width = 100 + Math.random() * 100;
      beam.speed = 0.5 + Math.random() * 0.4;
      beam.hue = HUE_BASE + (index * HUE_SPREAD) / totalBeams;
      beam.opacity = 0.2 + Math.random() * 0.1;
      return beam;
    }

    function drawBeam(context: CanvasRenderingContext2D, beam: Beam) {
      context.save();
      context.translate(beam.x, beam.y);
      context.rotate((beam.angle * Math.PI) / 180);

      const pulsingOpacity =
        beam.opacity * (0.8 + Math.sin(beam.pulse) * 0.2) * OPACITY_MAP[intensity];

      const gradient = context.createLinearGradient(0, 0, 0, beam.length);
      gradient.addColorStop(0, `hsla(${beam.hue}, 85%, 65%, 0)`);
      gradient.addColorStop(0.1, `hsla(${beam.hue}, 85%, 65%, ${pulsingOpacity * 0.5})`);
      gradient.addColorStop(0.4, `hsla(${beam.hue}, 85%, 65%, ${pulsingOpacity})`);
      gradient.addColorStop(0.6, `hsla(${beam.hue}, 85%, 65%, ${pulsingOpacity})`);
      gradient.addColorStop(0.9, `hsla(${beam.hue}, 85%, 65%, ${pulsingOpacity * 0.5})`);
      gradient.addColorStop(1, `hsla(${beam.hue}, 85%, 65%, 0)`);

      context.fillStyle = gradient;
      context.fillRect(-beam.width / 2, 0, beam.width, beam.length);
      context.restore();
    }

    function paint(advance: boolean) {
      if (!ctx) return;
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      ctx.filter = "blur(35px)";

      const totalBeams = beamsRef.current.length;
      beamsRef.current.forEach((beam, index) => {
        if (advance) {
          beam.y -= beam.speed;
          beam.pulse += beam.pulseSpeed;
          if (beam.y + beam.length < -100) resetBeam(beam, index, totalBeams);
        }
        drawBeam(ctx, beam);
      });
    }

    // Reduced motion: one static frame, no loop, no listeners to tear down.
    if (reduceMotion) {
      paint(false);
      return () => window.removeEventListener("resize", updateCanvasSize);
    }

    let running = true;
    function animate() {
      if (!running) return;
      paint(true);
      animationFrameRef.current = requestAnimationFrame(animate);
    }

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(animationFrameRef.current);
      } else if (!running) {
        running = true;
        animate();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    animate();

    return () => {
      running = false;
      window.removeEventListener("resize", updateCanvasSize);
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [intensity, reduceMotion]);

  return (
    <div
      aria-hidden={children ? undefined : true}
      className={cn(
        fixed
          ? "pointer-events-none fixed inset-0 -z-10 overflow-hidden"
          : "relative w-full overflow-hidden bg-background",
        className,
      )}
    >
      <canvas ref={canvasRef} className="absolute inset-0" style={{ filter: "blur(15px)" }} />

      {/*
        Scrim. The page is a data dashboard whose body text is held to WCAG AA;
        a bright beam drifting under a paragraph erodes that. Damping the beams
        against the theme background keeps them as atmosphere rather than
        contrast noise.
      */}
      <motion.div
        className="absolute inset-0 bg-background/60"
        animate={reduceMotion ? undefined : { opacity: [0.82, 0.9, 0.82] }}
        transition={
          reduceMotion
            ? undefined
            : { duration: 10, ease: "easeInOut", repeat: Number.POSITIVE_INFINITY }
        }
        style={{ backdropFilter: "blur(50px)" }}
      />

      {children ? <div className="relative z-10">{children}</div> : null}
    </div>
  );
}
