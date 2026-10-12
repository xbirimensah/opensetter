"use client";

/**
 * Where the selected card is edited.
 *
 * Wide screens: a translucent panel floating over the left of the canvas.
 * It slides in from the left and leaves the same way.
 *
 * Phones: a bottom sheet over the canvas. The grabber tracks the finger
 * 1:1; on release the sheet projects the flick's momentum, snaps to half or
 * full height (or closes), and settles on a spring that starts at the
 * finger's velocity. Reduced motion swaps the spring for a short fade.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EASE } from "../ui";

/** Apple's projection: where a flick would come to rest. */
export function projectMomentum(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Rubber-band past a bound: the further out, the less it follows. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Animates a value to `to` on a spring that starts at `velocity` (px/s).
 * response = seconds to reach the target, damping 1 = no overshoot.
 */
function springTo(params: {
  from: number;
  to: number;
  velocity: number;
  response: number;
  damping: number;
  onUpdate: (value: number) => void;
  onDone: () => void;
}): () => void {
  const { from, to, response, damping, onUpdate, onDone } = params;
  const stiffness = (2 * Math.PI / response) ** 2;
  const friction = (4 * Math.PI * damping) / response;
  let x = from;
  let v = params.velocity;
  let last = performance.now();
  let frame = 0;
  const step = (now: number) => {
    let dt = Math.min(0.064, (now - last) / 1000);
    last = now;
    // Small fixed substeps keep the integration stable on slow frames.
    while (dt > 0) {
      const h = Math.min(dt, 1 / 240);
      const a = -stiffness * (x - to) - friction * v;
      v += a * h;
      x += v * h;
      dt -= h;
    }
    if (Math.abs(v) < 4 && Math.abs(x - to) < 0.5) {
      onUpdate(to);
      onDone();
      return;
    }
    onUpdate(x);
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

export function FloatingPanel({
  open,
  top,
  label,
  children,
}: {
  open: boolean;
  /** Distance from the editor top (below the floating top bar). */
  top: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      aria-hidden={!open}
      inert={!open}
      className={`nokey absolute bottom-3 left-3 z-20 flex w-[min(400px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-surface/90 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.45)] backdrop-blur-2xl backdrop-saturate-150 transition-[translate,opacity] duration-300 ${EASE} motion-reduce:transition-opacity [@media(prefers-reduced-transparency:reduce)]:bg-surface ${
        open ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-6 opacity-0 motion-reduce:translate-x-0"
      }`}
      style={{ top }}
    >
      {children}
    </aside>
  );
}

export const SNAP_HALF = 0.55;
const SNAP_FULL = 0.92;

export function BottomSheet({
  open,
  onClose,
  label,
  children,
  onHeightChange,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
  /** Visible sheet height in px, so the canvas can keep the selection clear of it. */
  onHeightChange?: (height: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  // translateY in px from the top of the editor (container height = closed).
  const yRef = useRef(0);
  const stopRef = useRef<() => void>(() => undefined);
  const dragRef = useRef<{ pointerId: number; startY: number; startSheetY: number; samples: { y: number; t: number }[] } | null>(null);
  const [mounted, setMounted] = useState(open);
  const [snap, setSnap] = useState(SNAP_HALF);
  const onCloseRef = useRef(onClose);
  const heightRef = useRef(onHeightChange);
  useEffect(() => {
    onCloseRef.current = onClose;
    heightRef.current = onHeightChange;
  });

  function containerHeight(): number {
    return rootRef.current?.parentElement?.clientHeight ?? window.innerHeight;
  }

  function apply(y: number) {
    yRef.current = y;
    if (sheetRef.current) sheetRef.current.style.transform = `translate3d(0, ${y}px, 0)`;
  }

  /** Reported once the sheet settles, never per frame. */
  function report() {
    heightRef.current?.(Math.max(0, containerHeight() - yRef.current));
  }

  function animateTo(target: number, velocity: number, done?: () => void, bouncy = false) {
    stopRef.current();
    const finish = () => {
      report();
      done?.();
    };
    if (prefersReducedMotion()) {
      apply(target);
      finish();
      return;
    }
    stopRef.current = springTo({
      from: yRef.current,
      to: target,
      velocity,
      response: bouncy ? 0.3 : 0.38,
      damping: bouncy ? 0.85 : 1,
      onUpdate: apply,
      onDone: finish,
    });
  }

  // Mount as soon as it opens (derived state); unmount after the close animation.
  if (open && !mounted) setMounted(true);

  // Open and close follow `open`; a selection change keeps the sheet where it is.
  useLayoutEffect(() => {
    if (!mounted) return;
    const h = containerHeight();
    if (open) {
      if (yRef.current === 0 || yRef.current >= h) apply(h);
      animateTo(h * (1 - snap), 0);
    } else {
      animateTo(h, 0, () => setMounted(false));
    }
    // animateTo/apply only touch refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted]);

  useEffect(() => () => stopRef.current(), []);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    stopRef.current();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone (or synthetic); tracking still works without capture.
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startSheetY: yRef.current,
      samples: [{ y: event.clientY, t: event.timeStamp }],
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const h = containerHeight();
    const top = h * (1 - SNAP_FULL);
    let y = drag.startSheetY + (event.clientY - drag.startY);
    if (y < top) y = top - rubberband(top - y, h);
    apply(y);
    drag.samples = [...drag.samples.slice(-4), { y: event.clientY, t: event.timeStamp }];
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const first = drag.samples[0];
    const last = drag.samples[drag.samples.length - 1];
    const dt = Math.max(1, last.t - first.t);
    const velocity = ((last.y - first.y) / dt) * 1000;
    const h = containerHeight();
    const projected = yRef.current + projectMomentum(velocity);
    const options = [
      { snap: SNAP_FULL, y: h * (1 - SNAP_FULL) },
      { snap: SNAP_HALF, y: h * (1 - SNAP_HALF) },
      { snap: 0, y: h },
    ];
    const target = options.reduce((best, option) => (Math.abs(option.y - projected) < Math.abs(best.y - projected) ? option : best));
    const flicked = Math.abs(velocity) > 500;
    if (target.snap === 0) {
      animateTo(h, velocity, () => onCloseRef.current());
      return;
    }
    setSnap(target.snap);
    animateTo(target.y, velocity, undefined, flicked);
  }

  if (!mounted) return null;

  return (
    <div ref={rootRef} className="nokey pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <div
        ref={sheetRef}
        role="dialog"
        aria-label={label}
        aria-modal="false"
        className="pointer-events-auto absolute inset-x-0 top-0 flex flex-col rounded-t-[1.5rem] border-t border-border bg-surface/95 shadow-[0_-18px_50px_-20px_rgb(0_0_0/0.45)] backdrop-blur-2xl backdrop-saturate-150 will-change-transform motion-reduce:transition-opacity [@media(prefers-reduced-transparency:reduce)]:bg-surface"
        style={{ height: `${SNAP_FULL * 100}%`, transform: "translate3d(0, 100vh, 0)" }}
      >
        <div
          className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-2.5 active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <button
            type="button"
            aria-label={snap === SNAP_FULL ? "Shrink panel" : "Expand panel"}
            onClick={() => {
              const next = snap === SNAP_FULL ? SNAP_HALF : SNAP_FULL;
              setSnap(next);
              animateTo(containerHeight() * (1 - next), 0);
            }}
            className="grid h-6 w-16 place-items-center"
          >
            <span className="h-1.5 w-10 rounded-full bg-border-hover" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
