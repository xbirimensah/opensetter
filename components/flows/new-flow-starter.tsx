"use client";

/**
 * Creates a flow and opens it: one account creates at once, several ask
 * which one, none asks to connect Instagram. A template builds the flow
 * from its keywords and DM (lib/flows/template-flow.ts).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FlowAccount } from "./api-types";
import { Button, PRESS } from "./ui";

// One request per account+template, even when React runs effects twice.
const inflight = new Map<string, Promise<string>>();

function createOnce(accountId: string, templateSlug: string | null): Promise<string> {
  const key = `${accountId}:${templateSlug ?? ""}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const request = fetch("/api/flows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instagramAccountId: accountId, ...(templateSlug ? { template: templateSlug } : {}) }),
  })
    .then(async (res) => {
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) throw new Error(payload?.error ?? "Could not create the flow");
      return payload.data.id as string;
    })
    .finally(() => {
      window.setTimeout(() => inflight.delete(key), 5000);
    });
  inflight.set(key, request);
  return request;
}

export function NewFlowStarter({ templateSlug, templateTitle }: { templateSlug: string | null; templateTitle: string | null }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<FlowAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const started = useRef(false);

  function start(accountId: string) {
    setCreating(true);
    setError(null);
    createOnce(accountId, templateSlug)
      .then((id) => router.replace(`/flows/${id}${templateSlug ? "?select=trigger" : ""}`))
      .catch((err: Error) => {
        setError(err.message);
        setCreating(false);
      });
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/flows", { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (cancelled) return;
        if (!payload?.success) throw new Error(payload?.error ?? "Could not load your accounts");
        const list = payload.accounts as FlowAccount[];
        setAccounts(list);
        if (list.length === 1 && !started.current) {
          started.current = true;
          start(list[0].id);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
    // start only reads stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = templateTitle ? `New flow from "${templateTitle}"` : "New flow";

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold tracking-[-0.02em] text-foreground">{title}</h1>
      {error ? (
        <div className="mt-4 space-y-4">
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
          <Link href="/flows" className="text-sm text-accent hover:underline">
            Back to flows
          </Link>
        </div>
      ) : accounts === null || creating || accounts.length === 1 ? (
        <p className="mt-3 inline-flex items-center gap-2 text-sm text-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent motion-reduce:animate-none" aria-hidden="true" />
          {templateTitle ? "Building the flow from the template…" : "Creating your flow…"}
        </p>
      ) : accounts.length === 0 ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted">Connect an Instagram account first. The flow is created right after.</p>
          <a
            href="/api/instagram/connect"
            className={`inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover sm:min-h-9 ${PRESS}`}
          >
            Connect Instagram
          </a>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          <p className="text-sm text-muted">Which account is it for?</p>
          <div className="flex flex-col gap-2">
            {accounts.map((account) => (
              <Button key={account.id} onClick={() => start(account.id)}>
                @{account.username}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
