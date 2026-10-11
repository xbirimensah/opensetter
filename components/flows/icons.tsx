/**
 * Line icons for the flow editor (24px grid, currentColor stroke).
 */

import type { FlowContent, FlowNodeType } from "@/lib/flows/types";

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Svg({ className = "h-4 w-4", children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...STROKE}>
      {children}
    </svg>
  );
}

type IconProps = { className?: string };

export const Icon = {
  message: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M21 11.5a8.4 8.4 0 01-9 8.4 9.9 9.9 0 01-4-.8L3 21l1.9-4.5A8.4 8.4 0 013 11.5 8.4 8.4 0 0112 3a8.4 8.4 0 019 8.5z" />
    </Svg>
  ),
  input: ({ className }: IconProps) => (
    <Svg className={className}>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <path d="M8 10v4M7 10h2M7 14h2" />
    </Svg>
  ),
  condition: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M6 3v6a3 3 0 003 3h6a3 3 0 013 3v6M18 3v6a3 3 0 01-3 3" />
      <path d="M3 18l3 3 3-3" />
    </Svg>
  ),
  action: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
    </Svg>
  ),
  delay: ({ className }: IconProps) => (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  ),
  randomizer: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
    </Svg>
  ),
  startFlow: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M14 4h5a1 1 0 011 1v14a1 1 0 01-1 1h-5" />
      <path d="M3 12h11M10 8l4 4-4 4" />
    </Svg>
  ),
  ai: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
    </Svg>
  ),
  plus: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  trash: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" />
    </Svg>
  ),
  copy: ({ className }: IconProps) => (
    <Svg className={className}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
    </Svg>
  ),
  chevron: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  ),
  up: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Svg>
  ),
  down: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </Svg>
  ),
  flag: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </Svg>
  ),
  more: ({ className }: IconProps) => (
    <Svg className={className}>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </Svg>
  ),
  text: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M5 6h14M12 6v13M9 19h6" />
    </Svg>
  ),
  image: ({ className }: IconProps) => (
    <Svg className={className}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M21 16l-5-5-8 9" />
    </Svg>
  ),
  video: ({ className }: IconProps) => (
    <Svg className={className}>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M16 10l6-3v10l-6-3z" />
    </Svg>
  ),
  audio: ({ className }: IconProps) => (
    <Svg className={className}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </Svg>
  ),
  file: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </Svg>
  ),
  cards: ({ className }: IconProps) => (
    <Svg className={className}>
      <rect x="3" y="5" width="13" height="14" rx="2" />
      <path d="M19 7v10M22 9v6" />
    </Svg>
  ),
  typing: ({ className }: IconProps) => (
    <Svg className={className}>
      <rect x="3" y="7" width="18" height="10" rx="5" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" />
    </Svg>
  ),
  link: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M10.5 13.5a4 4 0 005.7 0l2.3-2.3a4 4 0 00-5.7-5.7L11.5 6.8" />
      <path d="M13.5 10.5a4 4 0 00-5.7 0l-2.3 2.3a4 4 0 005.7 5.7l1.3-1.3" />
    </Svg>
  ),
  upload: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
    </Svg>
  ),
  check: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M5 12l5 5L20 7" />
    </Svg>
  ),
  close: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  ),
  braces: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M8 4H7a2 2 0 00-2 2v3a3 3 0 01-2 3 3 3 0 012 3v3a2 2 0 002 2h1M16 4h1a2 2 0 012 2v3a3 3 0 002 3 3 3 0 00-2 3v3a2 2 0 01-2 2h-1" />
    </Svg>
  ),
  bolt: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
    </Svg>
  ),
};

const NODE_ICONS: Record<FlowNodeType, (props: IconProps) => React.ReactElement> = {
  message: Icon.message,
  input: Icon.input,
  condition: Icon.condition,
  action: Icon.action,
  delay: Icon.delay,
  randomizer: Icon.randomizer,
  start_flow: Icon.startFlow,
  ai_handoff: Icon.ai,
};

/** Tinted tile per step type; tints come from the app's status tokens. */
export const NODE_TINTS: Record<FlowNodeType, string> = {
  message: "bg-accent/10 text-accent",
  input: "bg-success/10 text-success",
  condition: "bg-warning/10 text-warning",
  action: "bg-accent/10 text-accent",
  delay: "bg-muted/15 text-muted",
  randomizer: "bg-warning/10 text-warning",
  start_flow: "bg-accent/10 text-accent",
  ai_handoff: "bg-success/10 text-success",
};

export function NodeTypeIcon({ type, className = "h-4 w-4" }: { type: FlowNodeType; className?: string }) {
  const Component = NODE_ICONS[type];
  return <Component className={className} />;
}

const CONTENT_ICONS: Record<FlowContent["type"], (props: IconProps) => React.ReactElement> = {
  text: Icon.text,
  image: Icon.image,
  video: Icon.video,
  audio: Icon.audio,
  file: Icon.file,
  cards: Icon.cards,
  typing: Icon.typing,
};

export function ContentTypeIcon({ type, className = "h-4 w-4" }: { type: FlowContent["type"]; className?: string }) {
  const Component = CONTENT_ICONS[type];
  return <Component className={className} />;
}
