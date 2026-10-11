"use client";

/**
 * Action step: tags, custom fields, external request (webhook), notify the
 * owner, pause or resume the AI setter.
 */

import type { ActionNode, FlowAction } from "@/lib/flows/types";
import { FLOW_EDITOR_LIMITS, isJsonTemplate } from "@/lib/flows/validate";
import { useFlowEditor } from "./editor-context";
import { createAction, moveItem } from "./graph-utils";
import { Icon } from "./icons";
import { sanitizeFieldName } from "./step-editors";
import { StepSelect } from "./step-select";
import { IconButton, Menu, Segmented, TextField } from "./ui";

const ACTION_TYPES: { type: FlowAction["type"]; label: string; hint: string }[] = [
  { type: "add_tag", label: "Add tag", hint: "Label the contact" },
  { type: "remove_tag", label: "Remove tag", hint: "Take a label off" },
  { type: "set_field", label: "Set custom field", hint: "Store a value, variables allowed" },
  { type: "clear_field", label: "Clear custom field", hint: "Empty a stored value" },
  { type: "webhook", label: "External request", hint: "Send data to a webhook or your CRM" },
  { type: "notify", label: "Notify me", hint: "Shows up in Diagnostics" },
  { type: "pause_ai", label: "Pause AI setter", hint: "For this conversation" },
  { type: "resume_ai", label: "Resume AI setter", hint: "For this conversation" },
];

const ACTION_LABELS = Object.fromEntries(ACTION_TYPES.map((a) => [a.type, a.label])) as Record<FlowAction["type"], string>;

function ActionFields({ action, onChange }: { action: FlowAction; onChange: (action: FlowAction) => void }) {
  const { variables, fieldNames, tags } = useFlowEditor();

  switch (action.type) {
    case "add_tag":
    case "remove_tag":
      return (
        <TextField
          label="Tag"
          value={action.tag}
          max={FLOW_EDITOR_LIMITS.tagMax}
          placeholder="lead"
          suggestions={tags}
          onChange={(tag) => onChange({ ...action, tag })}
        />
      );
    case "set_field":
      return (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          <TextField
            label="Field name"
            value={action.key}
            mono
            placeholder="source"
            suggestions={fieldNames}
            onChange={(key) => onChange({ ...action, key: sanitizeFieldName(key) })}
          />
          <TextField
            label="Value"
            value={action.value}
            variables={variables}
            placeholder="{{comment}}"
            onChange={(value) => onChange({ ...action, value })}
          />
        </div>
      );
    case "clear_field":
      return (
        <TextField
          label="Field name"
          value={action.key}
          mono
          placeholder="source"
          suggestions={fieldNames}
          onChange={(key) => onChange({ ...action, key: sanitizeFieldName(key) })}
        />
      );
    case "webhook":
      return <WebhookFields action={action} onChange={onChange} />;
    case "notify":
      return (
        <TextField
          multiline
          rows={2}
          label="Message"
          value={action.message}
          max={FLOW_EDITOR_LIMITS.notifyMax}
          variables={variables}
          placeholder="New lead: {{username}} left {{email}}"
          onChange={(message) => onChange({ ...action, message })}
        />
      );
    case "pause_ai":
      return <p className="text-xs text-muted">The AI setter stops replying in this conversation until something resumes it.</p>;
    case "resume_ai":
      return <p className="text-xs text-muted">The AI setter replies in this conversation again.</p>;
  }
}

type WebhookAction = Extract<FlowAction, { type: "webhook" }>;

function WebhookFields({ action, onChange }: { action: WebhookAction; onChange: (action: FlowAction) => void }) {
  const { variables, fieldNames } = useFlowEditor();
  const headers = Object.entries(action.headers ?? {});
  const saves = action.saveResponse ?? [];
  const body = action.body ?? "";
  const bodyValid = !body.trim() || isJsonTemplate(body);

  const setHeaders = (entries: [string, string][]) =>
    onChange({ ...action, headers: entries.length > 0 ? Object.fromEntries(entries) : undefined });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Segmented
          ariaLabel="Method"
          options={[
            { value: "POST", label: "POST" },
            { value: "GET", label: "GET" },
          ]}
          value={action.method ?? "POST"}
          onChange={(method) => onChange({ ...action, method })}
        />
      </div>
      <TextField
        label="URL"
        value={action.url}
        inputMode="url"
        variables={variables}
        placeholder="https://hooks.example.com/new-lead"
        onChange={(url) => onChange({ ...action, url })}
      />
      {(action.method ?? "POST") === "POST" && (
        <div className="space-y-1.5">
          <TextField
            multiline
            mono
            rows={4}
            label="JSON body"
            value={body}
            variables={variables}
            invalid={!bodyValid}
            placeholder={'{\n  "email": "{{email}}",\n  "instagram": "{{username}}"\n}'}
            onChange={(next) => onChange({ ...action, body: next || undefined })}
          />
          <p className={`text-xs ${bodyValid ? "text-muted" : "text-error"}`}>
            {bodyValid
              ? body.trim()
                ? "Variables are filled in and escaped for JSON."
                : "Leave empty to send the full contact profile."
              : "This is not valid JSON yet."}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Headers</p>
        {headers.map(([key, value], index) => (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
            <TextField
              value={key}
              mono
              placeholder="Authorization"
              onChange={(nextKey) => setHeaders(headers.map((h, i) => (i === index ? [nextKey, h[1]] : h)))}
            />
            <TextField
              value={value}
              mono
              placeholder="Bearer ..."
              onChange={(nextValue) => setHeaders(headers.map((h, i) => (i === index ? [h[0], nextValue] : h)))}
            />
            <IconButton label="Delete header" tone="danger" onClick={() => setHeaders(headers.filter((_, i) => i !== index))}>
              <Icon.trash className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        ))}
        {headers.length < FLOW_EDITOR_LIMITS.webhookHeadersMax && (
          <button
            type="button"
            onClick={() => setHeaders([...headers, [`X-Header-${headers.length + 1}`, ""]])}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-accent hover:bg-accent/10 sm:min-h-8"
          >
            <Icon.plus className="h-3.5 w-3.5" />
            Add header
          </button>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Save from the response</p>
        {saves.map((save, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2">
            <TextField
              value={save.path}
              mono
              placeholder="data.booking_url"
              onChange={(path) =>
                onChange({ ...action, saveResponse: saves.map((s, i) => (i === index ? { ...s, path } : s)) })
              }
            />
            <span className="text-xs text-muted">into</span>
            <TextField
              value={save.key}
              mono
              placeholder="booking_url"
              suggestions={fieldNames}
              onChange={(key) =>
                onChange({
                  ...action,
                  saveResponse: saves.map((s, i) => (i === index ? { ...s, key: sanitizeFieldName(key) } : s)),
                })
              }
            />
            <IconButton
              label="Delete saved value"
              tone="danger"
              onClick={() => {
                const next = saves.filter((_, i) => i !== index);
                onChange({ ...action, saveResponse: next.length > 0 ? next : undefined });
              }}
            >
              <Icon.trash className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        ))}
        {saves.length < FLOW_EDITOR_LIMITS.webhookSaveMax && (
          <button
            type="button"
            onClick={() => onChange({ ...action, saveResponse: [...saves, { path: "", key: "" }] })}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-accent hover:bg-accent/10 sm:min-h-8"
          >
            <Icon.plus className="h-3.5 w-3.5" />
            Save a value
          </button>
        )}
        <p className="text-xs text-muted">Use dot paths into the JSON response, then read them as {"{{field.<name>}}"}.</p>
      </div>
    </div>
  );
}

export function ActionEditor({ node, onChange }: { node: ActionNode; onChange: (node: ActionNode) => void }) {
  const actions = node.actions;
  const set = (next: FlowAction[]) => onChange({ ...node, actions: next });

  return (
    <div className="space-y-3">
      {actions.map((action, index) => (
        <div key={action.id} className="space-y-3 rounded-lg border border-border bg-background/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted">{ACTION_LABELS[action.type]}</span>
            <div className="flex items-center">
              <IconButton label="Move action up" disabled={index === 0} onClick={() => set(moveItem(actions, index, -1))}>
                <Icon.up className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton label="Move action down" disabled={index === actions.length - 1} onClick={() => set(moveItem(actions, index, 1))}>
                <Icon.down className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton label="Delete action" tone="danger" onClick={() => set(actions.filter((_, i) => i !== index))}>
                <Icon.trash className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          </div>
          <ActionFields action={action} onChange={(next) => set(actions.map((a, i) => (i === index ? next : a)))} />
        </div>
      ))}

      {actions.length < FLOW_EDITOR_LIMITS.actionsMax && (
        <Menu
          width="w-64"
          items={ACTION_TYPES.map((a) => ({
            label: a.label,
            hint: a.hint,
            onSelect: () => set([...actions, createAction(a.type)]),
          }))}
          trigger={(props) => (
            <button
              type="button"
              {...props}
              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-sm text-muted transition-colors hover:border-border-hover hover:text-foreground sm:min-h-10"
            >
              <Icon.plus className="h-4 w-4" />
              Add action
            </button>
          )}
        />
      )}

      <div className="border-t border-border pt-4">
        <StepSelect label="Then" value={node.next} ownerId={node.id} onChange={(next) => onChange({ ...node, next })} />
      </div>
    </div>
  );
}
