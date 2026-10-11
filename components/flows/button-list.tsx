"use client";

/**
 * Up to three buttons under a text or a card: open a URL (optionally
 * tracked), go to a step, or start another flow.
 */

import Link from "next/link";
import { LIMITS, type FlowButton } from "@/lib/flows/types";
import { createButton, moveItem } from "./graph-utils";
import { useFlowEditor } from "./editor-context";
import { Icon } from "./icons";
import { StepSelect } from "./step-select";
import { IconButton, Menu, Segmented, Select, TextField, Toggle } from "./ui";

const BUTTON_TYPES: { value: FlowButton["type"]; label: string }[] = [
  { value: "url", label: "Open URL" },
  { value: "next", label: "Go to step" },
  { value: "flow", label: "Start flow" },
];

function retype(button: FlowButton, type: FlowButton["type"]): FlowButton {
  if (button.type === type) return button;
  const fresh = createButton(type);
  return { ...fresh, id: button.id, title: button.title || fresh.title } as FlowButton;
}

export function ButtonList({
  buttons,
  onChange,
  ownerId,
}: {
  buttons: FlowButton[];
  onChange: (buttons: FlowButton[]) => void;
  ownerId: string;
}) {
  const { flows, flowId, variables } = useFlowEditor();
  const update = (index: number, button: FlowButton) => onChange(buttons.map((b, i) => (i === index ? button : b)));

  return (
    <div className="space-y-2">
      {buttons.map((button, index) => (
        <div key={button.id} className="space-y-3 rounded-lg border border-border bg-background/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented
              ariaLabel="Button type"
              options={BUTTON_TYPES}
              value={button.type}
              onChange={(type) => update(index, retype(button, type))}
            />
            <div className="flex items-center">
              <IconButton label="Move button up" disabled={index === 0} onClick={() => onChange(moveItem(buttons, index, -1))}>
                <Icon.up className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                label="Move button down"
                disabled={index === buttons.length - 1}
                onClick={() => onChange(moveItem(buttons, index, 1))}
              >
                <Icon.down className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton label="Delete button" tone="danger" onClick={() => onChange(buttons.filter((_, i) => i !== index))}>
                <Icon.trash className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          </div>

          <TextField
            label="Button title"
            value={button.title}
            max={LIMITS.buttonTitleMax}
            placeholder={button.type === "url" ? "Open link" : "Yes, send it"}
            onChange={(title) => update(index, { ...button, title })}
          />

          {button.type === "url" && (
            <>
              <TextField
                label="URL"
                value={button.url}
                inputMode="url"
                placeholder="https://yourlink.com/offer"
                variables={variables}
                onChange={(url) => update(index, { ...button, url })}
              />
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">Track clicks</p>
                  <p className="text-xs text-muted">Routes through a short link so clicks show up in stats.</p>
                </div>
                <Toggle
                  label="Track clicks"
                  on={button.track ?? false}
                  onToggle={() => update(index, { ...button, track: !(button.track ?? false) })}
                />
              </div>
            </>
          )}

          {button.type === "next" && (
            <StepSelect
              label="When tapped"
              value={button.next}
              ownerId={ownerId}
              onChange={(next) => update(index, { ...button, next })}
            />
          )}

          {button.type === "flow" && (
            <div className="space-y-1.5">
              <Select label="Flow to start" value={button.flowId} onChange={(id) => update(index, { ...button, flowId: id })}>
                <option value="">Choose a flow</option>
                {flows.map((flow) => (
                  <option key={flow.id} value={flow.id}>
                    {flow.id === flowId ? `${flow.name} (restart this flow)` : flow.name}
                    {flow.status !== "ACTIVE" ? ` (${flow.status.toLowerCase()})` : ""}
                  </option>
                ))}
              </Select>
              {button.flowId && button.flowId !== flowId && (
                <Link href={`/flows/${button.flowId}`} className="inline-flex min-h-11 items-center text-xs text-accent hover:underline sm:min-h-0">
                  Open that flow
                </Link>
              )}
            </div>
          )}
        </div>
      ))}

      {buttons.length < LIMITS.buttonsMax && (
        <Menu
          items={BUTTON_TYPES.map((type) => ({
            label: type.label,
            onSelect: () => onChange([...buttons, createButton(type.value)]),
          }))}
          trigger={(props) => (
            <button
              type="button"
              {...props}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-accent hover:bg-accent/10 sm:min-h-8"
            >
              <Icon.plus className="h-3.5 w-3.5" />
              Add button ({buttons.length}/{LIMITS.buttonsMax})
            </button>
          )}
        />
      )}
    </div>
  );
}
