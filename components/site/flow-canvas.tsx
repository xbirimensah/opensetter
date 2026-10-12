import { Fragment } from "react";
import type { EditorTriggerType, FlowNodeType } from "@/lib/flows/types";

/* The same example flow as the hero strip, seen from the editor: one
   trigger card and the steps it runs. Step and trigger names mirror the
   types in lib/flows/types.ts. */

const nodes = [
  { type: "Message", title: "Private reply", detail: "Button: Yes, send it" },
  { type: "Input", title: "Ask for an email", detail: "Saves to Email, retries if invalid" },
  { type: "Message", title: "Send the guide", detail: "Tracked link button" },
  { type: "AI handoff", title: "Hand to the AI setter", detail: "Ends the flow, AI answers next" },
];

/* Typed against the engine, so a new step or trigger type fails the build
   until it gets a label here, and the counts on the page stay true. */
const STEP_LABELS: Record<FlowNodeType, string> = {
  message: "Message",
  input: "Input",
  condition: "Condition",
  action: "Action",
  delay: "Delay",
  randomizer: "Randomizer",
  start_flow: "Start flow",
  ai_handoff: "AI handoff",
};

/* The comment trigger plus every FlowTrigger that fires today.
   new_follower is left out: Meta does not deliver that event to this app
   yet, so the engine never fires it. */
const TRIGGER_LABELS: Record<Exclude<EditorTriggerType, "new_follower">, string> = {
  comment: "Comment",
  dm_keyword: "DM keyword",
  story_reply: "Story reply",
  story_mention: "Story mention",
  ref_link: "ig.me link",
  welcome: "Welcome",
  default_reply: "Default reply",
};

export const STEP_TYPES = Object.values(STEP_LABELS);
export const TRIGGERS = Object.values(TRIGGER_LABELS);

export function FlowCanvas() {
  return (
    <figure className="site-canvas px-4 py-8 sm:px-8 sm:py-10">
      <div className="site-node site-node-trigger">
        <p className="site-label site-accent-text">When</p>
        <p className="site-subheading mt-1">Someone comments on a reel</p>
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted">
          Keyword
          <span className="site-chip site-chip-accent">MATRIX</span>
        </p>
      </div>
      {nodes.map((node) => (
        <Fragment key={node.title}>
          <div className="site-connector" aria-hidden="true" />
          <div className="site-node">
            <p className="site-label">{node.type}</p>
            <p className="site-subheading mt-1">{node.title}</p>
            <p className="mt-1 text-[0.8125rem] leading-5 text-muted">{node.detail}</p>
          </div>
        </Fragment>
      ))}
      <figcaption className="sr-only">
        The example flow in the editor: a comment trigger on the keyword MATRIX,
        then a private reply, an email input, a message with the tracked link, and
        a hand-off to the AI setter.
      </figcaption>
    </figure>
  );
}

export function ChipList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="site-label">
        {items.length} {label}
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item} className="site-chip font-medium">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
