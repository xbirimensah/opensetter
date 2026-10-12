"use client";

/**
 * Editors for the DM-side triggers stored on Flow.triggers (DM keyword,
 * story reply and mention, ig.me ref link, welcome, default reply, new
 * follower). The canvas trigger sidebar lists them next to comment
 * triggers (comment-trigger-editor.tsx).
 */

import { useState } from "react";
import KeywordInput from "@/components/keyword-input";
import type { FlowTrigger, FlowTriggerType, KeywordMatch } from "@/lib/flows/types";
import { FLOW_EDITOR_LIMITS } from "@/lib/flows/validate";
import { Icon } from "./icons";
import { Button, Segmented, Select, TextField, ToggleRow } from "./ui";

export const NEW_FOLLOWER_NOTE =
  "Instagram only offers this to Meta partners right now. OpenSetter will start it automatically if Meta enables follow events for this app.";

export const TRIGGER_HINTS: Record<FlowTriggerType, string> = {
  dm_keyword: "They send you a DM with a keyword",
  story_reply: "They reply to one of your stories",
  story_mention: "They mention you in their story",
  ref_link: "They open your ig.me link",
  welcome: "Their first message to you, ever",
  default_reply: "Nothing else matched and the AI setter is off",
  new_follower: NEW_FOLLOWER_NOTE,
};

export const TRIGGER_ORDER: FlowTriggerType[] = [
  "dm_keyword",
  "story_reply",
  "story_mention",
  "ref_link",
  "welcome",
  "default_reply",
  "new_follower",
];

export const SINGLETONS: FlowTriggerType[] = ["welcome", "default_reply", "story_mention", "new_follower"];

const MATCH_OPTIONS: { value: KeywordMatch; label: string }[] = [
  { value: "contains", label: "Contains" },
  { value: "is", label: "Is exactly" },
  { value: "whole_word", label: "Whole word" },
  { value: "begins_with", label: "Begins with" },
];

function refUrl(username: string, ref: string): string {
  return `https://ig.me/m/${username}?ref=${encodeURIComponent(ref)}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Icon.check className="h-3.5 w-3.5 text-success" /> : <Icon.copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function TriggerFields({
  trigger,
  username,
  onChange,
}: {
  trigger: FlowTrigger;
  username: string;
  onChange: (trigger: FlowTrigger) => void;
}) {
  switch (trigger.type) {
    case "dm_keyword":
      return (
        <div className="space-y-3">
          <KeywordInput
            keywords={trigger.keywords}
            max={FLOW_EDITOR_LIMITS.keywordsMax}
            onChange={(keywords) => onChange({ ...trigger, keywords })}
          />
          <Select
            label="Match"
            value={trigger.match}
            onChange={(match) => onChange({ ...trigger, match: match as KeywordMatch })}
          >
            {MATCH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Do not start when the DM has</p>
            <KeywordInput
              keywords={trigger.excludeKeywords ?? []}
              max={FLOW_EDITOR_LIMITS.keywordsMax}
              onChange={(excludeKeywords) =>
                onChange({ ...trigger, excludeKeywords: excludeKeywords.length > 0 ? excludeKeywords : undefined })
              }
            />
          </div>
        </div>
      );
    case "story_reply": {
      const specific = (trigger.keywords?.length ?? 0) > 0 || trigger.match !== undefined;
      return (
        <div className="space-y-3">
          <Segmented
            ariaLabel="Which story replies"
            options={[
              { value: "any", label: "Any story reply" },
              { value: "keywords", label: "With keywords" },
            ]}
            value={specific ? "keywords" : "any"}
            onChange={(mode) =>
              onChange(
                mode === "any"
                  ? { id: trigger.id, type: "story_reply" }
                  : { ...trigger, keywords: trigger.keywords ?? [], match: trigger.match ?? "contains" }
              )
            }
          />
          {specific && (
            <>
              <KeywordInput
                keywords={trigger.keywords ?? []}
                max={FLOW_EDITOR_LIMITS.keywordsMax}
                onChange={(keywords) => onChange({ ...trigger, keywords })}
              />
              <Select
                label="Match"
                value={trigger.match ?? "contains"}
                onChange={(match) => onChange({ ...trigger, match: match as KeywordMatch })}
              >
                {MATCH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </>
          )}
        </div>
      );
    }
    case "story_mention":
      return (
        <ToggleRow
          label="Once per 24 hours"
          description="Do not restart for the same person within a day."
          on={trigger.oncePer24h ?? false}
          onToggle={() => onChange({ ...trigger, oncePer24h: !(trigger.oncePer24h ?? false) })}
        />
      );
    case "default_reply":
      return (
        <ToggleRow
          label="Once per 24 hours"
          description="Reply at most once a day per person."
          on={trigger.oncePer24h ?? false}
          onToggle={() => onChange({ ...trigger, oncePer24h: !(trigger.oncePer24h ?? false) })}
        />
      );
    case "ref_link": {
      const url = refUrl(username, trigger.ref);
      return (
        <div className="space-y-3">
          <TextField
            label="Ref"
            value={trigger.ref}
            mono
            placeholder="bio-link"
            onChange={(ref) => onChange({ ...trigger, ref: ref.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) })}
          />
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Link to share</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground">
                {url}
              </code>
              <CopyButton text={url} />
            </div>
            <p className="text-xs text-muted">Put it in your bio, a story link sticker, an ad or a QR code.</p>
          </div>
        </div>
      );
    }
    case "welcome":
      return <p className="text-xs text-muted">Runs once, on the very first message a new contact sends you.</p>;
    case "new_follower":
      return <p className="text-xs leading-relaxed text-muted">{NEW_FOLLOWER_NOTE}</p>;
  }
}
