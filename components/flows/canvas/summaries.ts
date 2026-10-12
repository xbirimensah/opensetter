/**
 * Short labels for canvas cards: default step titles and one-line
 * descriptions of rules and actions.
 */

import type { FlowAction, FlowInputType, FlowNode, FlowRule } from "@/lib/flows/types";
import { formatDuration } from "../graph-utils";

const INPUT_TITLES: Record<FlowInputType, string> = {
  email: "Collect Email",
  phone: "Collect Phone",
  number: "Collect Number",
  text: "Collect Answer",
  url: "Collect Link",
};

/** The card title when the step has no name of its own. */
export function defaultStepTitle(node: FlowNode): string {
  switch (node.type) {
    case "message":
      return "Send Message";
    case "input":
      return INPUT_TITLES[node.inputType];
    case "condition":
      return "Condition";
    case "action":
      return "Actions";
    case "delay":
      return "Smart Delay";
    case "randomizer":
      return "Randomizer";
    case "start_flow":
      return "Start Another Flow";
    case "ai_handoff":
      return "Hand Off to AI Setter";
  }
}

export function stepTitle(node: FlowNode): string {
  return node.name?.trim() || defaultStepTitle(node);
}

/** "Instagram" for steps that message the person, "Logic" or "Action" for the rest. */
export function stepChannel(node: FlowNode): string {
  if (node.type === "message" || node.type === "input") return "Instagram";
  if (node.type === "action" || node.type === "start_flow" || node.type === "ai_handoff") return "Action";
  return "Logic";
}

const SUBJECTS: Record<FlowRule["subject"], string> = {
  follows: "Follows you",
  tag: "Tag",
  email: "Email",
  phone: "Phone",
  field: "Field",
  last_input: "Last message",
};

const OPS: Record<FlowRule["op"], string> = {
  is_true: "is yes",
  is_false: "is no",
  has: "has",
  has_not: "has not",
  is_set: "is set",
  is_not_set: "is not set",
  equals: "is",
  not_equals: "is not",
  contains: "contains",
};

export function describeRule(rule: FlowRule): string {
  const subject = rule.subject === "field" ? `Field ${rule.key || "?"}` : SUBJECTS[rule.subject];
  if (rule.subject === "follows") return rule.op === "is_false" ? "Does not follow you" : "Follows you";
  const value = rule.value?.trim() ? ` "${rule.value.trim()}"` : "";
  return `${subject} ${OPS[rule.op]}${value}`;
}

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url || "no URL yet";
  }
}

export function describeAction(action: FlowAction): string {
  switch (action.type) {
    case "add_tag":
      return `Add tag ${action.tag || "?"}`;
    case "remove_tag":
      return `Remove tag ${action.tag || "?"}`;
    case "set_field":
      return `Set ${action.key || "field"}`;
    case "clear_field":
      return `Clear ${action.key || "field"}`;
    case "webhook":
      return `${action.method ?? "POST"} to ${host(action.url)}`;
    case "notify":
      return "Notify me";
    case "pause_ai":
      return "Pause the AI setter";
    case "resume_ai":
      return "Resume the AI setter";
  }
}

export function describeDelay(seconds: number): string {
  return `Wait ${formatDuration(seconds)}`;
}
