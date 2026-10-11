"use client";

/**
 * Lists the {{variables}} flow texts can use; tap one to copy it.
 */

import { useState } from "react";
import { FLOW_VARIABLES } from "@/lib/flows/validate";
import { Icon } from "./icons";
import { PRESS } from "./ui";

export function VariablesPanel({ fieldNames }: { fieldNames: string[] }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(token);
      window.setTimeout(() => setCopied((current) => (current === token ? null : current)), 1200);
    } catch {
      setCopied(null);
    }
  }

  const rows = [
    ...FLOW_VARIABLES.filter((v) => v.token !== "{{field.<name>}}"),
    ...fieldNames.map((name) => ({ token: `{{field.${name}}}`, description: "Custom field in this flow" })),
  ];

  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold tracking-tight text-foreground">Variables</h3>
      <p className="mt-0.5 text-xs text-muted">
        Use them in texts, field values and webhooks. Empty values render as nothing. Custom fields read as{" "}
        <code className="font-mono">{"{{field.<name>}}"}</code>.
      </p>
      <ul className="mt-3 space-y-1">
        {rows.map((row) => (
          <li key={row.token}>
            <button
              type="button"
              onClick={() => void copy(row.token)}
              className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-surface-hover sm:min-h-9 ${PRESS}`}
            >
              <code className="shrink-0 font-mono text-xs text-accent">{row.token}</code>
              <span className="min-w-0 flex-1 truncate text-xs text-muted">{row.description}</span>
              {copied === row.token ? (
                <Icon.check className="h-3.5 w-3.5 shrink-0 text-success" />
              ) : (
                <Icon.copy className="h-3.5 w-3.5 shrink-0 text-faint" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
