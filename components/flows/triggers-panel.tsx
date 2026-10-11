"use client";

/**
 * "Starts when" panel: the DM-side triggers stored on the flow, plus the
 * comment campaigns that run it (comment triggers live on the campaign).
 */

import Link from "next/link";
import { useState } from "react";
import KeywordInput from "@/components/keyword-input";
import type { FlowTrigger, FlowTriggerType, KeywordMatch } from "@/lib/flows/types";
import { FLOW_EDITOR_LIMITS, TRIGGER_TYPE_LABELS } from "@/lib/flows/validate";
import type { FlowCampaignRef } from "./api-types";
import { createTrigger } from "./graph-utils";
import { Icon } from "./icons";
import { Button, IconButton, IssueList, Menu, Segmented, Select, TextField, ToggleRow } from "./ui";

export const NEW_FOLLOWER_NOTE =
  "Instagram only offers this to Meta partners right now. OpenSetter will start it automatically if Meta enables follow events for this app.";

const TRIGGER_HINTS: Record<FlowTriggerType, string> = {
  dm_keyword: "They send you a DM with a keyword",
  story_reply: "They reply to one of your stories",
  story_mention: "They mention you in their story",
  ref_link: "They open your ig.me link",
  welcome: "Their first message to you, ever",
  default_reply: "Nothing else matched and the AI setter is off",
  new_follower: NEW_FOLLOWER_NOTE,
};

const TRIGGER_ORDER: FlowTriggerType[] = [
  "dm_keyword",
  "story_reply",
  "story_mention",
  "ref_link",
  "welcome",
  "default_reply",
  "new_follower",
];

const SINGLETONS: FlowTriggerType[] = ["welcome", "default_reply", "story_mention", "new_follower"];

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

function TriggerFields({
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

export function TriggersPanel({
  triggers,
  onChange,
  username,
  campaigns,
  flowId,
  issuesByTrigger,
  generalTriggerErrors,
}: {
  triggers: FlowTrigger[];
  onChange: (triggers: FlowTrigger[]) => void;
  username: string;
  campaigns: FlowCampaignRef[];
  flowId: string;
  issuesByTrigger: Map<string, string[]>;
  generalTriggerErrors: string[];
}) {
  const present = new Set(triggers.map((t) => t.type));
  const update = (index: number, trigger: FlowTrigger) => onChange(triggers.map((t, i) => (i === index ? trigger : t)));

  return (
    <section aria-labelledby="flow-triggers" className="rounded-2xl border border-border bg-surface">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
          <Icon.bolt className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="flow-triggers" className="text-sm font-semibold tracking-tight text-foreground">
            Starts when
          </h2>
          <p className="text-xs text-muted">Comment triggers come from the campaigns below.</p>
        </div>
        {triggers.length < FLOW_EDITOR_LIMITS.triggersMax && (
          <Menu
            align="right"
            width="w-72"
            items={TRIGGER_ORDER.map((type) => ({
              label: TRIGGER_TYPE_LABELS[type],
              hint: TRIGGER_HINTS[type],
              muted: type === "new_follower",
              disabled: SINGLETONS.includes(type) && present.has(type),
              onSelect: () => onChange([...triggers, createTrigger(type)]),
            }))}
            trigger={(props) => (
              <Button size="sm" {...props}>
                <Icon.plus className="h-3.5 w-3.5" />
                Add trigger
              </Button>
            )}
          />
        )}
      </header>

      <div className="space-y-3 p-4">
        <IssueList errors={generalTriggerErrors} />
        {triggers.length === 0 && (
          <p className="text-sm text-muted">
            No DM triggers yet. Add one, link the flow to a comment campaign, or start it from another flow.
          </p>
        )}
        {triggers.map((trigger, index) => {
          const disabled = trigger.type === "new_follower";
          return (
            <div
              key={trigger.id}
              className={`space-y-3 rounded-xl border border-border p-3 ${disabled ? "bg-surface-hover/50" : ""}`}
            >
              <div className="flex items-start gap-2">
                <div className={`min-w-0 flex-1 ${disabled ? "opacity-70" : ""}`}>
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    {TRIGGER_TYPE_LABELS[trigger.type]}
                    {disabled && (
                      <span className="rounded-full bg-muted/15 px-2 py-0.5 text-[11px] font-medium text-muted">Not available yet</span>
                    )}
                  </p>
                  {!disabled && <p className="text-xs text-muted">{TRIGGER_HINTS[trigger.type]}</p>}
                </div>
                <IconButton label="Remove trigger" tone="danger" onClick={() => onChange(triggers.filter((_, i) => i !== index))}>
                  <Icon.trash className="h-3.5 w-3.5" />
                </IconButton>
              </div>
              <TriggerFields trigger={trigger} username={username} onChange={(next) => update(index, next)} />
              <IssueList errors={issuesByTrigger.get(trigger.id)} />
            </div>
          );
        })}

        <div className="space-y-2 rounded-xl border border-dashed border-border p-3">
          <p className="text-sm font-medium text-foreground">Comment campaigns</p>
          {campaigns.length === 0 ? (
            <p className="text-xs text-muted">No campaign runs this flow yet.</p>
          ) : (
            <ul className="space-y-1">
              {campaigns.map((campaign) => (
                <li key={campaign.id} className="flex items-center justify-between gap-2">
                  <Link href={`/campaigns/${campaign.id}`} className="min-h-11 min-w-0 truncate py-2 text-sm text-accent hover:underline sm:min-h-0 sm:py-0.5">
                    {campaign.name}
                  </Link>
                  <span className={`shrink-0 text-xs ${campaign.isActive ? "text-success" : "text-muted"}`}>
                    {campaign.isActive ? "Live" : "Paused"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/campaigns/new?flowId=${flowId}`}
            className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-accent hover:underline sm:min-h-0"
          >
            <Icon.plus className="h-3.5 w-3.5" />
            Use in a comment campaign
          </Link>
        </div>
      </div>
    </section>
  );
}
