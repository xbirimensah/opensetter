/**
 * Shared class strings for the inbox. Press feedback lands on pointer-down
 * (:active) and is instant to read, short to settle; reduced motion keeps
 * the color change and drops the scale.
 */

export const PRESS =
  "transition-[scale,background-color,color,opacity] duration-100 ease-out active:scale-[0.97] motion-reduce:active:scale-100";

/** Small neutral pill used for source badges and status chips. */
export const PILL =
  "inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-px text-[10px] font-medium leading-4 tracking-[0.02em]";

/** Section heading in the contact panel: small caps-style label. */
export const SECTION_LABEL = "text-footnote font-semibold text-muted";
