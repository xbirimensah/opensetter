"use client";

/**
 * "Next step" picker: another step by name, "End flow", or a brand new
 * step of any type that gets linked right away.
 */

import type { FlowNodeType } from "@/lib/flows/types";
import { NODE_TYPE_LABELS } from "@/lib/flows/validate";
import { useFlowEditor } from "./editor-context";
import { Select } from "./ui";

export const NODE_TYPE_ORDER: FlowNodeType[] = [
  "message",
  "input",
  "condition",
  "action",
  "delay",
  "randomizer",
  "start_flow",
  "ai_handoff",
];

const NEW_PREFIX = "new:";

export function StepSelect({
  value,
  onChange,
  label = "Next step",
  endLabel = "End flow",
  ownerId,
  className,
}: {
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  label?: string;
  /** Label of the empty choice ("End flow", "Wait for a tap"). */
  endLabel?: string;
  /** The step that owns this picker; new steps are inserted after it. */
  ownerId?: string;
  className?: string;
}) {
  const { steps, createStep } = useFlowEditor();
  const current = value ?? "";
  const missing = current !== "" && !steps.some((s) => s.id === current);

  return (
    <Select
      label={label}
      value={current}
      className={className}
      onChange={(next) => {
        if (next.startsWith(NEW_PREFIX)) {
          onChange(createStep(next.slice(NEW_PREFIX.length) as FlowNodeType, ownerId));
          return;
        }
        onChange(next || null);
      }}
    >
      <option value="">{endLabel}</option>
      {missing && <option value={current}>Missing step (choose another)</option>}
      {steps.length > 0 && (
        <optgroup label="Go to step">
          {steps.map((step) => (
            <option key={step.id} value={step.id}>
              {step.label}
              {step.id === ownerId ? " (this step)" : ""}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Create a new step">
        {NODE_TYPE_ORDER.map((type) => (
          <option key={type} value={`${NEW_PREFIX}${type}`}>
            New: {NODE_TYPE_LABELS[type]}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}
