/**
 * One-line, human descriptions of a flow's triggers for lists and the
 * canvas trigger card: "Comment: matrix on any post", "DM keyword: hi".
 */

import { commentPostScope } from "./comment-triggers";
import type { CommentTrigger, EditorTrigger } from "./types";

const LIST_MAX = 3;

function listWords(words: string[] | undefined, max = LIST_MAX): string {
  const list = (words ?? []).map((w) => w.trim()).filter(Boolean);
  const shown = list.slice(0, max).join(", ");
  return list.length > max ? `${shown} +${list.length - max}` : shown;
}

function commentWhere(trigger: CommentTrigger): string {
  switch (commentPostScope(trigger)) {
    case "any":
      return "any post";
    case "next_reel":
      return "your next reel";
    default:
      return trigger.postId ? "a specific post" : "a post (not chosen yet)";
  }
}

export function describeEditorTrigger(trigger: EditorTrigger): string {
  switch (trigger.type) {
    case "comment": {
      const words = trigger.matchAnyWord ? "any comment" : listWords(trigger.keywords) || "no keyword yet";
      return `Comment: ${words} on ${commentWhere(trigger)}`;
    }
    case "dm_keyword":
      return `DM keyword: ${listWords(trigger.keywords) || "none yet"}`;
    case "story_reply": {
      const words = listWords(trigger.keywords);
      return words ? `Story reply: ${words}` : "Story reply: any story";
    }
    case "story_mention":
      return "Story mention";
    case "ref_link":
      return `ig.me link: ?ref=${trigger.ref}`;
    case "welcome":
      return "Welcome message";
    case "default_reply":
      return "Default reply";
    case "new_follower":
      return "New follower (waiting on Meta)";
  }
}

/** All triggers on one line; comment triggers first, as the editor lists them. */
export function summarizeEditorTriggers(triggers: EditorTrigger[]): string {
  const ordered = [...triggers.filter((t) => t.type === "comment"), ...triggers.filter((t) => t.type !== "comment")];
  return ordered.map(describeEditorTrigger).join(" · ");
}
