import { animate, remove, scrambleText } from "animejs";
import { prefersReducedMotion } from "./motion";

/* Plays the "How it works" phone: a comment, the private reply, the email
   ask, the tracked link and the AI setter hand-off, looping. The step list
   beside the phone follows along and doubles as controls: tap a step to
   jump there. Pauses off screen and in background tabs; with reduced
   motion it never autoplays and jumps cut instead of animating. */

/** How long each step stays on screen, start to start (ms). */
const STEP_MS = [3400, 3200, 4200, 3200, 5600];
const LAST_STEP = STEP_MS.length - 1;
const TYPING_MS = 750;

class Cancelled extends Error {}

interface Run {
  cancelled: boolean;
}

export function initStory(root: HTMLElement) {
  const comments = root.querySelector<HTMLElement>('[data-scene="comments"]');
  const dm = root.querySelector<HTMLElement>('[data-scene="dm"]');
  const thread = root.querySelector<HTMLElement>("[data-thread]");
  const typing = root.querySelector<HTMLElement>("[data-typing]");
  const newComment = root.querySelector<HTMLElement>("[data-new-comment]");
  const keyword = root.querySelector<HTMLElement>("[data-keyword]");
  const replied = root.querySelector<HTMLElement>("[data-replied]");
  const tap = root.querySelector<HTMLElement>("[data-tap]");
  const stepButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-step-btn]")];
  if (!comments || !dm || !thread || !typing || !newComment || !keyword || !replied || !tap) {
    console.warn("[story] markup incomplete, demo disabled");
    return;
  }

  const messages = [...thread.querySelectorAll<HTMLElement>("[data-msg]")];
  const at = (el: HTMLElement) => Number(el.dataset.at);
  const reduced = prefersReducedMotion();

  /* ---------- pausable clock ---------- */
  let visible = false;
  const running = () => visible && !document.hidden;

  function wait(ms: number, run: Run): Promise<void> {
    return new Promise((resolve, reject) => {
      let elapsed = 0;
      let last = performance.now();
      const tick = (now: number) => {
        if (run.cancelled) return reject(new Cancelled());
        if (running()) elapsed += now - last;
        last = now;
        if (elapsed >= ms) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /* ---------- step list ---------- */
  let progressAnim: ReturnType<typeof animate> | null = null;

  const stepTitle = root.querySelector<HTMLElement>("[data-step-title]");
  const stepNum = root.querySelector<HTMLElement>("[data-step-num]");

  /** Highlights `step` in the list and the phone segments. Segments fill
      like Stories: done steps full, the current one filling. */
  function markStep(step: number, animateBar: boolean) {
    progressAnim?.pause();
    const filling: HTMLElement[] = [];
    stepButtons.forEach((btn) => {
      const i = Number(btn.dataset.stepBtn);
      const isSegment = btn.hasAttribute("data-seg");
      if (i === step) btn.setAttribute("aria-current", "step");
      else btn.removeAttribute("aria-current");
      const bar = btn.querySelector<HTMLElement>("[data-step-progress]");
      if (!bar) return;
      const done = (isSegment && i < step) || (i === step && !animateBar);
      bar.style.width = done ? "100%" : "0%";
      if (i === step && animateBar) filling.push(bar);
      if (i === step && isSegment) {
        if (stepTitle) stepTitle.textContent = btn.dataset.title ?? "";
        if (stepNum) stepNum.textContent = String(step + 1);
      }
    });
    if (filling.length) {
      progressAnim = animate(filling, { width: ["0%", "100%"], duration: STEP_MS[step], ease: "linear" });
    }
  }

  // The bar only moves while the demo does.
  const syncProgress = () => (running() ? progressAnim?.resume() : progressAnim?.pause());

  /* ---------- instant state ---------- */
  function setScene(name: "comments" | "dm") {
    const show = name === "comments" ? comments! : dm!;
    const hide = name === "comments" ? dm! : comments!;
    show.style.visibility = "visible";
    show.style.opacity = "1";
    show.style.transform = "none";
    hide.style.visibility = "hidden";
  }

  /** Everything exactly as it looks at the end of `step`. */
  function renderAt(step: number) {
    remove([comments!, dm!, tap!, keyword!, ...messages]);
    setScene(step === 0 ? "comments" : "dm");
    newComment!.hidden = false;
    replied!.hidden = false;
    typing!.hidden = true;
    messages.forEach((m) => {
      m.hidden = at(m) > step;
      m.style.transform = "";
      m.style.opacity = "";
    });
  }

  /* ---------- FLIP for the thread ---------- */
  function flip(container: HTMLElement, mutate: () => void) {
    const before = new Map<Element, number>();
    for (const child of container.children) {
      if (!(child as HTMLElement).hidden) before.set(child, child.getBoundingClientRect().top);
    }
    mutate();
    for (const child of container.children) {
      const el = child as HTMLElement;
      if (el.hidden) continue;
      const top = before.get(el);
      if (top === undefined) {
        const fromRight = el.classList.contains("bubble-out") || el.classList.contains("typing");
        el.style.transformOrigin = fromRight ? "bottom right" : "bottom left";
        animate(el, {
          opacity: [0, 1],
          translateY: [14, 0],
          scale: [0.92, 1],
          duration: 520,
          ease: "outBack(1.2)",
        });
      } else {
        const dy = top - el.getBoundingClientRect().top;
        if (dy !== 0) animate(el, { translateY: [dy, 0], duration: 480, ease: "outExpo" });
      }
    }
  }

  async function say(step: number, run: Run) {
    for (const msg of messages.filter((m) => at(m) === step)) {
      if (msg.hasAttribute("data-typed")) {
        flip(thread!, () => (typing!.hidden = false));
        await wait(TYPING_MS + (step === LAST_STEP ? 600 : 0), run);
        flip(thread!, () => {
          typing!.hidden = true;
          msg.hidden = false;
        });
      } else {
        flip(thread!, () => (msg.hidden = false));
      }
      await wait(msg.classList.contains("bubble-meta") ? 350 : 650, run);
    }
  }

  /* ---------- the beats ---------- */
  async function playStep(step: number, run: Run) {
    switch (step) {
      case 0: {
        renderAt(0);
        newComment!.hidden = true;
        replied!.hidden = true;
        messages.forEach((m) => (m.hidden = true));
        await wait(500, run);
        flip(newComment!.parentElement!, () => (newComment!.hidden = false));
        animate(keyword!, {
          innerHTML: scrambleText({ chars: "uppercase", text: "MATRIX" }),
          duration: 700,
        });
        await wait(1100, run);
        flip(newComment!.parentElement!, () => (replied!.hidden = false));
        return;
      }
      case 1: {
        // Into the DM, sliding in from the right like a push in Instagram.
        dm!.style.visibility = "visible";
        animate(comments!, { opacity: [1, 0], translateX: [0, -36], duration: 420, ease: "outQuad" });
        await animate(dm!, { opacity: [0, 1], translateX: [48, 0], duration: 520, ease: "outExpo" });
        if (run.cancelled) throw new Cancelled();
        comments!.style.visibility = "hidden";
        await say(1, run);
        return;
      }
      case 2: {
        animate(tap!, {
          scale: [1, 0.9, 1],
          backgroundColor: ["rgba(255,255,255,0.16)", "rgba(255,255,255,0.42)", "rgba(255,255,255,0.16)"],
          duration: 480,
          ease: "outQuad",
        });
        await wait(450, run);
        await say(2, run);
        return;
      }
      default:
        await say(step, run);
    }
  }

  let current: Run = { cancelled: true };

  async function loop(from: number) {
    current.cancelled = true;
    const run: Run = { cancelled: false };
    current = run;
    let step = from;
    try {
      for (;;) {
        markStep(step, true);
        syncProgress();
        const stepStart = performance.now();
        await playStep(step, run);
        // Hold whatever time is left of the step's slot.
        await wait(Math.max(0, STEP_MS[step] - (performance.now() - stepStart)), run);
        if (step === LAST_STEP) {
          await animate(dm!, { opacity: [1, 0], duration: 400, ease: "outQuad" });
          if (run.cancelled) return;
          step = 0;
        } else {
          step += 1;
        }
      }
    } catch (error) {
      if (!(error instanceof Cancelled)) console.error("[story]", error);
    }
  }

  /* ---------- wiring ---------- */
  let started = false;

  // The list and the phone segments both carry data-step-btn, so the
  // step comes from the attribute, not the button's position.
  stepButtons.forEach((btn) =>
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.stepBtn);
      if (!(i >= 0 && i <= LAST_STEP)) return;
      if (reduced) {
        renderAt(i);
        markStep(i, false);
        return;
      }
      // Land on the state just before the step, then play it live.
      started = true;
      current.cancelled = true;
      if (i > 0) renderAt(i - 1);
      loop(i);
    })
  );

  if (reduced) {
    renderAt(LAST_STEP);
    markStep(LAST_STEP, false);
    return;
  }

  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      syncProgress();
      if (visible && !started) {
        started = true;
        loop(0);
      }
    },
    { threshold: 0.6 }
  ).observe(root.querySelector("[data-story-phone]") ?? root);
  document.addEventListener("visibilitychange", syncProgress);
}
