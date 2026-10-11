"use client";

/**
 * Editors for the input, condition, delay, randomizer, start-flow and
 * AI-handoff steps.
 */

import Link from "next/link";
import type {
  AiHandoffNode,
  ConditionNode,
  DelayNode,
  FlowInputType,
  FlowRule,
  FlowRuleOp,
  FlowRuleSubject,
  InputNode,
  RandomizerNode,
  StartFlowNode,
} from "@/lib/flows/types";
import { LIMITS } from "@/lib/flows/types";
import { FLOW_EDITOR_LIMITS, parseSaveTo, RULE_OPS } from "@/lib/flows/validate";
import { useFlowEditor } from "./editor-context";
import { createRule, newId } from "./graph-utils";
import { Icon } from "./icons";
import { StepSelect } from "./step-select";
import { Button, IconButton, NumberField, Segmented, Select, TextField } from "./ui";

export function sanitizeFieldName(value: string): string {
  return value.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40);
}

// ─── Input ────────────────────────────────────────────────────────────────

const INPUT_TYPES: { value: FlowInputType; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "number", label: "Number" },
  { value: "text", label: "Text" },
  { value: "url", label: "URL" },
];

const PROMPT_PLACEHOLDER: Record<FlowInputType, string> = {
  email: "What's the best email to send it to?",
  phone: "What's your phone number?",
  number: "How many clients do you have right now?",
  text: "What's your biggest challenge right now?",
  url: "Send me the link to your website",
};

export function InputEditor({ node, onChange }: { node: InputNode; onChange: (node: InputNode) => void }) {
  const { variables, fieldNames } = useFlowEditor();
  const target = parseSaveTo(node.saveTo);
  const saveKind = node.saveTo.startsWith("field:") ? "field" : target?.kind ?? "field";
  const fieldKey = node.saveTo.startsWith("field:") ? node.saveTo.slice("field:".length) : "";

  function changeType(inputType: FlowInputType) {
    // Keep the save target in step with the question when it obviously should.
    let saveTo = node.saveTo;
    if (inputType === "email" || inputType === "phone") {
      if (saveKind !== "field") saveTo = inputType;
    } else if (saveKind !== "field") {
      saveTo = `field:${inputType === "number" ? "number" : "answer"}`;
    }
    onChange({ ...node, inputType, saveTo });
  }

  return (
    <div className="space-y-4">
      <TextField
        multiline
        label="Question"
        rows={3}
        value={node.prompt}
        max={LIMITS.textMax}
        variables={variables}
        placeholder={PROMPT_PLACEHOLDER[node.inputType]}
        onChange={(prompt) => onChange({ ...node, prompt })}
      />

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Expect</p>
        <Segmented ariaLabel="Answer type" options={INPUT_TYPES} value={node.inputType} onChange={changeType} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Save to"
          value={saveKind}
          onChange={(kind) =>
            onChange({ ...node, saveTo: kind === "field" ? `field:${fieldKey || "answer"}` : kind })
          }
        >
          <option value="email">Email</option>
          <option value="phone">Phone</option>
          <option value="field">Custom field</option>
        </Select>
        {saveKind === "field" && (
          <TextField
            label="Field name"
            value={fieldKey}
            mono
            placeholder="company_size"
            suggestions={fieldNames}
            onChange={(key) => onChange({ ...node, saveTo: `field:${sanitizeFieldName(key)}` })}
          />
        )}
      </div>

      <TextField
        multiline
        rows={2}
        label="If the answer is not valid"
        value={node.retryMessage ?? ""}
        max={LIMITS.textMax}
        variables={variables}
        placeholder="That does not look right. Could you send it again?"
        onChange={(retryMessage) => onChange({ ...node, retryMessage: retryMessage || undefined })}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <NumberField
          label="Retries"
          value={node.maxRetries ?? 2}
          min={0}
          max={FLOW_EDITOR_LIMITS.inputMaxRetries}
          onChange={(maxRetries) => onChange({ ...node, maxRetries })}
        />
        <NumberField
          label="Wait for an answer"
          value={node.timeoutMinutes ?? 1440}
          min={1}
          max={FLOW_EDITOR_LIMITS.inputTimeoutMaxMinutes}
          suffix="min"
          onChange={(timeoutMinutes) => onChange({ ...node, timeoutMinutes })}
        />
        <TextField
          label="Skip button"
          value={node.skipLabel ?? ""}
          max={LIMITS.quickReplyTitleMax}
          placeholder="Optional"
          onChange={(skipLabel) => onChange({ ...node, skipLabel: skipLabel || undefined })}
        />
      </div>
      <p className="-mt-2 text-xs text-muted">
        The wait is capped by Instagram&apos;s 24 hour window. A Skip button shows as a quick reply and takes the fail path.
      </p>

      <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
        <StepSelect label="When answered" value={node.next} ownerId={node.id} onChange={(next) => onChange({ ...node, next })} />
        <StepSelect
          label="When it fails or they skip"
          value={node.onFail}
          ownerId={node.id}
          onChange={(onFail) => onChange({ ...node, onFail })}
        />
      </div>
    </div>
  );
}

// ─── Condition ────────────────────────────────────────────────────────────

const SUBJECT_LABELS: Record<FlowRuleSubject, string> = {
  follows: "Follows your account",
  tag: "Tag",
  email: "Email",
  phone: "Phone",
  field: "Custom field",
  last_input: "Last message",
};

const OP_LABELS: Record<FlowRuleSubject, Partial<Record<FlowRuleOp, string>>> = {
  follows: { is_true: "is true", is_false: "is false" },
  tag: { has: "has tag", has_not: "does not have tag" },
  email: { is_set: "is set", is_not_set: "is not set" },
  phone: { is_set: "is set", is_not_set: "is not set" },
  field: { is_set: "is set", is_not_set: "is not set", equals: "equals", not_equals: "does not equal", contains: "contains" },
  last_input: { equals: "equals", not_equals: "does not equal", contains: "contains" },
};

const VALUE_OPS: FlowRuleOp[] = ["has", "has_not", "equals", "not_equals", "contains"];

function RuleRow({
  rule,
  onChange,
  onDelete,
}: {
  rule: FlowRule;
  onChange: (rule: FlowRule) => void;
  onDelete: () => void;
}) {
  const { fieldNames, tags } = useFlowEditor();
  const needsValue = VALUE_OPS.includes(rule.op);

  return (
    <div className="grid gap-2 rounded-lg border border-border bg-background/40 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <Select
        label="If"
        value={rule.subject}
        onChange={(subject) => onChange({ ...createRule(subject as FlowRuleSubject), id: rule.id })}
      >
        {(Object.keys(SUBJECT_LABELS) as FlowRuleSubject[]).map((subject) => (
          <option key={subject} value={subject}>
            {SUBJECT_LABELS[subject]}
          </option>
        ))}
      </Select>
      <Select label="Is" value={rule.op} onChange={(op) => onChange({ ...rule, op: op as FlowRuleOp })}>
        {RULE_OPS[rule.subject].map((op) => (
          <option key={op} value={op}>
            {OP_LABELS[rule.subject][op]}
          </option>
        ))}
      </Select>
      <IconButton label="Delete rule" tone="danger" onClick={onDelete} className="justify-self-end">
        <Icon.trash className="h-3.5 w-3.5" />
      </IconButton>
      {rule.subject === "field" && (
        <TextField
          label="Field name"
          value={rule.key ?? ""}
          mono
          placeholder="company_size"
          suggestions={fieldNames}
          onChange={(key) => onChange({ ...rule, key: sanitizeFieldName(key) })}
        />
      )}
      {needsValue && (
        <TextField
          label={rule.subject === "tag" ? "Tag" : "Value"}
          value={rule.value ?? ""}
          placeholder={rule.subject === "tag" ? "lead" : "yes"}
          suggestions={rule.subject === "tag" ? tags : undefined}
          onChange={(value) => onChange({ ...rule, value })}
        />
      )}
      {rule.subject === "follows" && (
        <p className="text-xs text-muted sm:col-span-3">
          Checked live with Instagram. If it cannot be verified it counts as following.
        </p>
      )}
    </div>
  );
}

export function ConditionEditor({ node, onChange }: { node: ConditionNode; onChange: (node: ConditionNode) => void }) {
  const rules = node.rules;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>Match</span>
        <Segmented
          ariaLabel="Match rules"
          options={[
            { value: "all", label: "All rules" },
            { value: "any", label: "Any rule" },
          ]}
          value={node.match}
          onChange={(match) => onChange({ ...node, match })}
        />
      </div>
      <div className="space-y-2">
        {rules.map((rule, index) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            onChange={(next) => onChange({ ...node, rules: rules.map((r, i) => (i === index ? next : r)) })}
            onDelete={() => onChange({ ...node, rules: rules.filter((_, i) => i !== index) })}
          />
        ))}
        {rules.length < FLOW_EDITOR_LIMITS.rulesMax && (
          <button
            type="button"
            onClick={() => onChange({ ...node, rules: [...rules, createRule("tag")] })}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-accent hover:bg-accent/10 sm:min-h-8"
          >
            <Icon.plus className="h-3.5 w-3.5" />
            Add rule
          </button>
        )}
      </div>
      <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
        <StepSelect label="If yes" value={node.next} ownerId={node.id} onChange={(next) => onChange({ ...node, next })} />
        <StepSelect label="If no" value={node.elseNext} ownerId={node.id} onChange={(elseNext) => onChange({ ...node, elseNext })} />
      </div>
    </div>
  );
}

// ─── Delay ────────────────────────────────────────────────────────────────

export function DelayEditor({ node, onChange }: { node: DelayNode; onChange: (node: DelayNode) => void }) {
  const unit: "minutes" | "hours" = node.seconds >= 3600 && node.seconds % 3600 === 0 ? "hours" : "minutes";
  const unitSeconds = unit === "hours" ? 3600 : 60;
  const amount = node.seconds / unitSeconds;
  const tooLong = node.seconds > FLOW_EDITOR_LIMITS.delayWarnSeconds;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 sm:max-w-sm">
        <NumberField
          label="Wait"
          value={amount}
          min={1}
          max={unit === "hours" ? 24 : 1440}
          onChange={(value) => onChange({ ...node, seconds: Math.round(value * unitSeconds) })}
        />
        <Select
          label="Unit"
          value={unit}
          onChange={(next) => {
            const nextSeconds = next === "hours" ? 3600 : 60;
            onChange({ ...node, seconds: Math.max(1, Math.round(amount)) * nextSeconds });
          }}
        >
          <option value="minutes">minutes</option>
          <option value="hours">hours</option>
        </Select>
      </div>
      {tooLong ? (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          Longer than 23 hours: the 24h window will close unless the person writes again, and the run expires.
        </p>
      ) : (
        <p className="text-xs text-muted">Instagram only allows automated messages within 24 hours of their last message.</p>
      )}
      <div className="border-t border-border pt-4">
        <StepSelect label="Then" value={node.next} ownerId={node.id} onChange={(next) => onChange({ ...node, next })} />
      </div>
    </div>
  );
}

// ─── Randomizer ───────────────────────────────────────────────────────────

export function RandomizerEditor({ node, onChange }: { node: RandomizerNode; onChange: (node: RandomizerNode) => void }) {
  const branches = node.branches;
  const total = branches.reduce((sum, b) => sum + (b.weight > 0 ? b.weight : 0), 0);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Each person is sent down one branch at random, weighted. They keep the same branch if they come back.</p>
      {branches.map((branch, index) => (
        <div key={branch.id} className="grid gap-2 rounded-lg border border-border bg-background/40 p-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-end">
          <NumberField
            label={`Branch ${String.fromCharCode(65 + index)}`}
            value={branch.weight}
            min={1}
            suffix={total > 0 && branch.weight > 0 ? `${Math.round((branch.weight / total) * 100)}%` : undefined}
            onChange={(weight) => onChange({ ...node, branches: branches.map((b, i) => (i === index ? { ...b, weight } : b)) })}
          />
          <StepSelect
            label="Goes to"
            value={branch.next}
            ownerId={node.id}
            onChange={(next) => onChange({ ...node, branches: branches.map((b, i) => (i === index ? { ...b, next } : b)) })}
          />
          <IconButton
            label="Delete branch"
            tone="danger"
            disabled={branches.length <= FLOW_EDITOR_LIMITS.branchesMin}
            onClick={() => onChange({ ...node, branches: branches.filter((_, i) => i !== index) })}
          >
            <Icon.trash className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {branches.length < FLOW_EDITOR_LIMITS.branchesMax && (
          <Button size="sm" onClick={() => onChange({ ...node, branches: [...branches, { id: newId("r"), weight: 50, next: null }] })}>
            <Icon.plus className="h-3.5 w-3.5" />
            Add branch
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange({ ...node, branches: branches.map((b) => ({ ...b, weight: 1 })) })}
        >
          Split evenly
        </Button>
      </div>
    </div>
  );
}

// ─── Start flow / AI handoff ──────────────────────────────────────────────

export function StartFlowEditor({ node, onChange }: { node: StartFlowNode; onChange: (node: StartFlowNode) => void }) {
  const { flows, flowId } = useFlowEditor();
  const others = flows.filter((flow) => flow.id !== flowId);
  return (
    <div className="space-y-2">
      <Select label="Flow to start" value={node.flowId} onChange={(id) => onChange({ ...node, flowId: id })}>
        <option value="">Choose a flow</option>
        {others.map((flow) => (
          <option key={flow.id} value={flow.id}>
            {flow.name}
            {flow.status !== "ACTIVE" ? ` (${flow.status.toLowerCase()})` : ""}
          </option>
        ))}
      </Select>
      {others.length === 0 && <p className="text-xs text-muted">No other flows on this Instagram account yet.</p>}
      <p className="text-xs text-muted">Ends this flow and starts the other one from its first step.</p>
      {node.flowId && (
        <Link href={`/flows/${node.flowId}`} className="inline-flex min-h-11 items-center text-xs text-accent hover:underline sm:min-h-0">
          Open that flow
        </Link>
      )}
    </div>
  );
}

export function AiHandoffEditor({ node }: { node: AiHandoffNode }) {
  return (
    <div className="space-y-1.5" data-node={node.id}>
      <p className="text-sm text-foreground">Ends the flow and lets the AI setter take over this conversation.</p>
      <p className="text-xs text-muted">
        It replies with your persona and knowledge, as set up in{" "}
        <Link href="/ai-setter" className="text-accent hover:underline">
          AI Setter
        </Link>
        .
      </p>
    </div>
  );
}
