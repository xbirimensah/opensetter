"use client";

/**
 * "What happens next?" menu: opens where a connection was dropped on empty
 * canvas, or above the floating add button. It grows out of its anchor
 * and closes on outside press or Escape.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FlowInputType, FlowNodeType } from "@/lib/flows/types";
import { Icon, NODE_TINTS, NodeTypeIcon } from "../icons";
import { EASE } from "../ui";

export type StepPreset = { type: Exclude<FlowNodeType, "input"> } | { type: "input"; inputType: FlowInputType };

interface Item {
  preset: StepPreset;
  label: string;
  hint: string;
}

export const STEP_GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Instagram",
    items: [{ preset: { type: "message" }, label: "Send Message", hint: "Text, media, cards, buttons" }],
  },
  {
    title: "Data Collection",
    items: [
      { preset: { type: "input", inputType: "email" }, label: "Email", hint: "Ask for their email" },
      { preset: { type: "input", inputType: "phone" }, label: "Phone", hint: "Ask for a phone number" },
      { preset: { type: "input", inputType: "text" }, label: "Text answer", hint: "Any free text reply" },
      { preset: { type: "input", inputType: "number" }, label: "Number", hint: "A number, validated" },
      { preset: { type: "input", inputType: "url" }, label: "Link", hint: "A website or profile link" },
    ],
  },
  {
    title: "Logic",
    items: [
      { preset: { type: "condition" }, label: "Condition", hint: "Branch on tags, fields, follows" },
      { preset: { type: "randomizer" }, label: "Randomizer", hint: "Split people for A/B tests" },
      { preset: { type: "delay" }, label: "Smart Delay", hint: "Wait minutes or hours" },
    ],
  },
  {
    title: "Actions",
    items: [
      { preset: { type: "action" }, label: "Actions", hint: "Tags, fields, webhooks, notify" },
      { preset: { type: "start_flow" }, label: "Start Another Flow", hint: "Jump into another flow" },
      { preset: { type: "ai_handoff" }, label: "AI Setter", hint: "Let the AI setter continue" },
    ],
  },
];

const MENU_WIDTH = 272;

export function StepTypeMenu({
  x,
  y,
  align,
  connected,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  align: "point" | "above";
  connected: boolean;
  onPick: (preset: StepPreset) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; origin: string } | null>(null);

  // Keep the menu inside the canvas; the origin stays on the anchor.
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement?.getBoundingClientRect();
    if (!el || !parent) return;
    const height = el.offsetHeight;
    let left = align === "above" ? x - MENU_WIDTH / 2 : x + 8;
    let top = align === "above" ? y - height - 10 : y + 8;
    left = Math.max(8, Math.min(left, parent.width - MENU_WIDTH - 8));
    top = Math.max(8, Math.min(top, parent.height - height - 8));
    setPlace({ left, top, origin: `${x - left}px ${y - top}px` });
  }, [x, y, align]);

  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) closeRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={connected ? "Add the next step" : "Add a step"}
      className={`nokey absolute z-40 max-h-[min(70vh,560px)] overflow-y-auto rounded-2xl border border-border bg-surface/95 p-1.5 shadow-2xl backdrop-blur-xl backdrop-saturate-150 transition-[opacity,scale] duration-150 ${EASE} starting:scale-95 starting:opacity-0 [@media(prefers-reduced-transparency:reduce)]:bg-surface`}
      style={{
        width: MENU_WIDTH,
        left: place?.left ?? x,
        top: place?.top ?? y,
        transformOrigin: place?.origin ?? "top left",
        visibility: place ? "visible" : "hidden",
      }}
    >
      <p className="px-2.5 pb-1 pt-1.5 text-[13px] font-semibold tracking-[-0.01em] text-foreground">
        {connected ? "Choose Next Step" : "Add a step"}
      </p>
      {STEP_GROUPS.map((group) => (
        <div key={group.title} className="py-1">
          <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">{group.title}</p>
          {group.items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => onPick(item.preset)}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-[background-color,scale] duration-150 hover:bg-surface-hover focus-visible:bg-surface-hover active:scale-[0.98] active:duration-75"
            >
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${NODE_TINTS[item.preset.type]}`}>
                {item.preset.type === "input" ? <Icon.input className="h-3.5 w-3.5" /> : <NodeTypeIcon type={item.preset.type} className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-foreground">{item.label}</span>
                <span className="block truncate text-[11px] text-muted">{item.hint}</span>
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
