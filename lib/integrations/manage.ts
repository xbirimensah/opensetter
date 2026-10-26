/**
 * Shared pieces of the Settings > Integrations API: manager-only access,
 * input schemas and the shapes sent to the browser (never a secret or
 * key hash).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { assertPublicHttpsUrl } from "@/lib/flows/safe-http";
import { canManageWorkspace, getCurrentWorkspaceContext, type WorkspaceContext } from "@/lib/workspace-access";
import { WEBHOOK_EVENTS } from "./catalog";

export const MAX_ENDPOINTS = 10;
export const MAX_API_KEYS = 10;

/** Integrations move contact data out of the app: owners and admins only. */
export async function requireIntegrationManager(): Promise<
  { ok: true; context: WorkspaceContext } | { ok: false; response: NextResponse }
> {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return { ok: false, response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }
  if (!canManageWorkspace(context.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Only workspace owners and admins can manage integrations." },
        { status: 403 }
      ),
    };
  }
  return { ok: true, context };
}

const urlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    try {
      assertPublicHttpsUrl(value);
      return true;
    } catch {
      return false;
    }
  }, "Use a public https URL");

const eventsSchema = z
  .array(z.enum(WEBHOOK_EVENTS))
  .min(1, "Pick at least one event")
  .transform((events) => [...new Set(events)]);

export const createEndpointSchema = z.strictObject({ url: urlSchema, events: eventsSchema });

export const updateEndpointSchema = z
  .strictObject({ url: urlSchema.optional(), events: eventsSchema.optional(), isActive: z.boolean().optional() })
  .refine((value) => Object.values(value).some((v) => v !== undefined), "Nothing to update");

export const createApiKeySchema = z.strictObject({ name: z.string().trim().min(1, "Name the key").max(60) });

export interface EndpointView {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  lastDeliveryAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: string;
}

export function toEndpointView(row: {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  lastDeliveryAt: Date | null;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: Date;
}): EndpointView {
  return {
    id: row.id,
    url: row.url,
    events: row.events,
    isActive: row.isActive,
    lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}

export const ENDPOINT_VIEW_SELECT = {
  id: true,
  url: true,
  events: true,
  isActive: true,
  lastDeliveryAt: true,
  lastStatus: true,
  lastError: true,
  createdAt: true,
} as const;

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export const API_KEY_VIEW_SELECT = { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true } as const;

export function toApiKeyView(row: { id: string; name: string; prefix: string; lastUsedAt: Date | null; createdAt: Date }): ApiKeyView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function badRequest(error: z.ZodError | string) {
  const message = typeof error === "string" ? error : error.issues[0]?.message ?? "Invalid request body";
  return NextResponse.json({ success: false, error: message }, { status: 400 });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
