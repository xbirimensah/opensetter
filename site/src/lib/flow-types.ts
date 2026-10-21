/* Labels for the flow engine's step and trigger types. They mirror
   FlowNodeType and EditorTriggerType in ../../../lib/flows/types.ts; the
   new_follower trigger is left out because Meta does not deliver that
   event to this app, so the engine never fires it. */

export const STEP_TYPES = [
  "Message",
  "Input",
  "Condition",
  "Action",
  "Delay",
  "Randomizer",
  "Start flow",
  "AI handoff",
];

export const TRIGGERS = [
  "Comment",
  "DM keyword",
  "Story reply",
  "Story mention",
  "ig.me link",
  "Welcome",
  "Default reply",
];
