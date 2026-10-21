import { animate, stagger } from "animejs";

/* Shared motion helpers for the public site. Everything here is
   progressive: without JS or with reduced motion, content is already in
   its final state (see html.js-motion in global.css). */

export const prefersReducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Run `fn` once, the first time `el` is mostly on screen. */
export function onceVisible(el: Element, fn: () => void, threshold = 0.3) {
  const io = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      fn();
    },
    { threshold }
  );
  io.observe(el);
}

/** [data-reveal] rises in when it enters the viewport; siblings that
    arrive together stagger. */
export function initReveal() {
  if (!document.documentElement.classList.contains("js-motion")) return;
  const pending = new Set<Element>();
  let frame = 0;
  const flush = () => {
    frame = 0;
    const batch = [...pending];
    pending.clear();
    animate(batch, {
      opacity: [0, 1],
      translateY: [24, 0],
      filter: ["blur(6px)", "blur(0px)"],
      duration: 900,
      delay: stagger(70),
      ease: "outExpo",
    });
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        pending.add(entry.target);
      }
      if (pending.size && !frame) frame = requestAnimationFrame(flush);
    },
    { threshold: 0.15, rootMargin: "0px 0px -6% 0px" }
  );
  document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
}

/** Pointer-following border glow on .glow cards (fine pointers only). */
export function initGlow() {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  document.querySelectorAll<HTMLElement>(".glow").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--gx", `${e.clientX - r.left}px`);
      card.style.setProperty("--gy", `${e.clientY - r.top}px`);
      card.style.setProperty("--go", "1");
    });
    card.addEventListener("pointerleave", () => card.style.setProperty("--go", "0"));
  });
}

/** Counts `el` up from 0 to `to`, formatted by `format`. */
export function countUp(el: HTMLElement, to: number, format: (n: number) => string, duration = 1400) {
  if (prefersReducedMotion()) {
    el.textContent = format(to);
    return;
  }
  const state = { n: 0 };
  animate(state, {
    n: to,
    duration,
    ease: "outExpo",
    onUpdate: () => (el.textContent = format(state.n)),
  });
}
