"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * "Comment on a post or reel" trigger: which post, which words, and the
 * public replies under the comment. Saved as the flow's Automation row,
 * so it behaves exactly like a comment campaign did.
 */

import Link from "next/link";
import { useState } from "react";
import KeywordInput from "@/components/keyword-input";
import PostPicker from "@/components/post-picker";
import {
  COMMENT_TRIGGER_LIMITS,
  commentPostScope,
  isInstagramPostUrl,
  withPostScope,
  type CommentPostScope,
} from "@/lib/flows/comment-triggers";
import type { CommentTrigger } from "@/lib/flows/types";
import { Icon } from "../icons";
import { Button, IconButton, Segmented, TextField, ToggleRow } from "../ui";

const SCOPES: { value: CommentPostScope; label: string }[] = [
  { value: "specific", label: "A post or reel" },
  { value: "any", label: "Any post" },
  { value: "next_reel", label: "Next reel" },
];

const SCOPE_NOTES: Record<CommentPostScope, string> = {
  specific: "Answers comments on the post or reel you pick.",
  any: "Answers matching comments on every post and reel, old and new.",
  next_reel: "Waits for the next reel you post, then answers comments on it.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{title}</p>
      {children}
    </section>
  );
}

export function CommentTriggerEditor({
  trigger,
  instagramAccountId,
  automationId,
  onChange,
}: {
  trigger: CommentTrigger;
  instagramAccountId: string;
  /** Set once saved; links to the per-trigger stats. */
  automationId: string | null;
  onChange: (trigger: CommentTrigger) => void;
}) {
  const scope = commentPostScope(trigger);
  const [picking, setPicking] = useState(scope === "specific" && !trigger.postId);
  const [thumb, setThumb] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const replies = trigger.publicReplyMessages.length > 0 ? trigger.publicReplyMessages : [""];

  const setReplies = (next: string[]) => onChange({ ...trigger, publicReplyMessages: next });

  return (
    <div className="space-y-5">
      <Section title="When someone comments on">
        <Segmented
          ariaLabel="Which posts"
          options={SCOPES}
          value={scope}
          onChange={(value) => {
            onChange(withPostScope(trigger, value));
            setPicking(value === "specific" && !trigger.postId);
          }}
        />
        <p className="text-xs text-muted">{SCOPE_NOTES[scope]}</p>
        {scope === "specific" && (
          <div className="space-y-2">
            {trigger.postId && !picking && (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-background/50 p-2">
                {thumb ? (
                  <img src={thumb} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-surface-hover text-faint">
                    <Icon.image className="h-4 w-4" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{caption || "Post selected"}</p>
                  {trigger.postUrl && isInstagramPostUrl(trigger.postUrl) && (
                    <a href={trigger.postUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                      Open on Instagram
                    </a>
                  )}
                </div>
                <Button size="sm" onClick={() => setPicking(true)}>
                  Change
                </Button>
              </div>
            )}
            {picking && (
              <div className="max-h-[22rem] overflow-y-auto rounded-xl border border-border p-2">
                <PostPicker
                  selectedPostId={trigger.postId}
                  instagramAccountId={instagramAccountId}
                  onSelect={(postId, postUrl, thumbUrl, postCaption) => {
                    onChange({ ...trigger, postId, postUrl: postUrl ?? null });
                    setThumb(thumbUrl ?? null);
                    setCaption(postCaption ?? "");
                    setPicking(false);
                  }}
                />
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="And the comment has">
        <Segmented
          ariaLabel="Which comments"
          options={[
            { value: "words", label: "Specific words" },
            { value: "any", label: "Any comment" },
          ]}
          value={trigger.matchAnyWord ? "any" : "words"}
          onChange={(value) => onChange({ ...trigger, matchAnyWord: value === "any" })}
        />
        {trigger.matchAnyWord ? (
          <p className="text-xs text-muted">Every comment starts the flow, once per comment.</p>
        ) : (
          <>
            <KeywordInput
              keywords={trigger.keywords}
              max={COMMENT_TRIGGER_LIMITS.keywordsMax}
              onChange={(keywords) =>
                onChange({ ...trigger, keywords: keywords.map((k) => k.slice(0, COMMENT_TRIGGER_LIMITS.keywordMax)) })
              }
            />
            <ToggleRow
              label="Whole words only"
              description={`"MATRIX" matches "matrix please" but not "matrixes". Case never matters.`}
              on={trigger.wholeWordMatch}
              onToggle={() => onChange({ ...trigger, wholeWordMatch: !trigger.wholeWordMatch })}
            />
          </>
        )}
      </Section>

      <Section title="AI opener">
        <ToggleRow
          label="Personalize the first message"
          description="The AI setter's model rewrites the flow's first message as a reply to what they commented. Falls back to your text if the model is slow (8 seconds by default) or anything goes wrong."
          on={trigger.aiPersonalizeOpener ?? false}
          onToggle={() => onChange({ ...trigger, aiPersonalizeOpener: !(trigger.aiPersonalizeOpener ?? false) })}
        />
      </Section>

      <Section title="Public reply">
        <ToggleRow
          label="Reply under the comment"
          description="Posts a public reply so others see you answered. One is picked at random each time."
          on={trigger.publicReplyEnabled}
          onToggle={() =>
            onChange({
              ...trigger,
              publicReplyEnabled: !trigger.publicReplyEnabled,
              publicReplyMessages: trigger.publicReplyMessages.length > 0 ? trigger.publicReplyMessages : [""],
            })
          }
        />
        {trigger.publicReplyEnabled && (
          <div className="space-y-2">
            {replies.map((reply, index) => (
              <div key={index} className="flex items-start gap-1.5">
                <TextField
                  className="flex-1"
                  multiline
                  rows={2}
                  value={reply}
                  max={COMMENT_TRIGGER_LIMITS.publicReplyMax}
                  hardMax={COMMENT_TRIGGER_LIMITS.publicReplyMax}
                  placeholder="Sent, check your DMs"
                  onChange={(text) => setReplies(replies.map((r, i) => (i === index ? text : r)))}
                />
                {replies.length > 1 && (
                  <IconButton label="Remove this reply" tone="danger" onClick={() => setReplies(replies.filter((_, i) => i !== index))}>
                    <Icon.trash className="h-3.5 w-3.5" />
                  </IconButton>
                )}
              </div>
            ))}
            {replies.length < COMMENT_TRIGGER_LIMITS.publicRepliesMax && (
              <button
                type="button"
                onClick={() => setReplies([...replies, ""])}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-accent hover:bg-accent/10 sm:min-h-8"
              >
                <Icon.plus className="h-3.5 w-3.5" />
                Add a variation ({replies.length}/{COMMENT_TRIGGER_LIMITS.publicRepliesMax})
              </button>
            )}
          </div>
        )}
      </Section>

      <div className="space-y-1.5 rounded-xl bg-surface-hover/70 px-3 py-2.5 text-xs leading-relaxed text-muted">
        <p>The flow&apos;s first message goes out as the private reply to the comment. Each comment is answered once.</p>
        {automationId && (
          <Link href={`/campaigns/${automationId}`} className="inline-flex min-h-11 items-center gap-1 font-medium text-accent hover:underline sm:min-h-0">
            View sends and clicks
          </Link>
        )}
      </div>
    </div>
  );
}
