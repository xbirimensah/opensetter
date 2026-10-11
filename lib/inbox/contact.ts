/**
 * Contact profile edits from the inbox (email, phone, tags, custom fields).
 *
 * Validation and the merge are pure so the route stays thin and the rules
 * are testable. Flows write the same columns, so limits here match what a
 * flow can produce.
 */

import { z } from "zod";
import type { ContactFieldValue } from "@/lib/inbox/types";

export const CONTACT_LIMITS = {
  emailMax: 254,
  tagMax: 50,
  tagsTotal: 100,
  tagsPerRequest: 20,
  fieldKeyMax: 40,
  fieldValueMax: 500,
  fieldsTotal: 100,
  fieldsPerRequest: 50,
} as const;

const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const emailSchema = z.preprocess(
  emptyToNull,
  z.union([
    z
      .string()
      .trim()
      .max(CONTACT_LIMITS.emailMax)
      .pipe(z.email({ message: "Enter a valid email address." })),
    z.null(),
  ])
);

const PHONE_PATTERN = /^\+?[0-9][0-9 ()./-]{3,30}$/;

const phoneSchema = z.preprocess(
  emptyToNull,
  z.union([
    z
      .string()
      .trim()
      .regex(PHONE_PATTERN, "Enter a valid phone number.")
      .refine((v) => v.replace(/\D/g, "").length >= 5, "Enter a valid phone number."),
    z.null(),
  ])
);

const tagSchema = z
  .string()
  .trim()
  .min(1, "Tags cannot be empty.")
  .max(CONTACT_LIMITS.tagMax, `Tags are at most ${CONTACT_LIMITS.tagMax} characters.`)
  .regex(/^[^\r\n\t]+$/, "Tags must be one line.");

export const fieldKeySchema = z
  .string()
  .trim()
  .min(1, "Field names cannot be empty.")
  .max(CONTACT_LIMITS.fieldKeyMax, `Field names are at most ${CONTACT_LIMITS.fieldKeyMax} characters.`)
  .regex(
    /^[A-Za-z0-9_][A-Za-z0-9_ .-]*$/,
    "Field names use letters, numbers, spaces, dots, dashes and underscores."
  )
  .refine((key) => !RESERVED_KEYS.has(key), "That field name is reserved.");

const fieldValueSchema = z.union([
  z.string().trim().max(CONTACT_LIMITS.fieldValueMax),
  z.number().finite(),
  z.boolean(),
]);

/** null is content here: it clears the email or phone. */
function hasContent(value: unknown): boolean {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export const contactPatchSchema = z
  .strictObject({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    addTags: z.array(tagSchema).max(CONTACT_LIMITS.tagsPerRequest).optional(),
    removeTags: z.array(tagSchema).max(CONTACT_LIMITS.tagsPerRequest).optional(),
    setFields: z.record(fieldKeySchema, fieldValueSchema).optional(),
    unsetFields: z.array(fieldKeySchema).max(CONTACT_LIMITS.fieldsPerRequest).optional(),
  })
  // Empty lists and records count as nothing (zod also drops "__proto__"
  // keys from records, which can leave one empty).
  .refine((patch) => Object.values(patch).some(hasContent), "Nothing to update.")
  .refine(
    (patch) => Object.keys(patch.setFields ?? {}).length <= CONTACT_LIMITS.fieldsPerRequest,
    `Set at most ${CONTACT_LIMITS.fieldsPerRequest} fields at once.`
  );

export type ContactPatch = z.infer<typeof contactPatchSchema>;

/** DmConversation.customFields JSON → a plain, validated record. */
export function parseCustomFields(value: unknown): Record<string, ContactFieldValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([key, v]) =>
        !RESERVED_KEYS.has(key) &&
        (typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)))
    )
  ) as Record<string, ContactFieldValue>;
}

export interface ContactState {
  email: string | null;
  phone: string | null;
  tags: string[];
  customFields: unknown;
}

export interface ContactUpdate {
  email?: string | null;
  emailCapturedAt?: Date | null;
  phone?: string | null;
  phoneCapturedAt?: Date | null;
  tags?: string[];
  customFields?: Record<string, ContactFieldValue>;
}

export type ApplyResult = { ok: true; data: ContactUpdate } | { ok: false; error: string };

/**
 * Merge a validated patch into the current contact. Returns only the
 * columns that change. Adding a tag that already exists in another case
 * keeps the existing spelling; removing matches exactly.
 */
export function applyContactPatch(
  current: ContactState,
  patch: ContactPatch,
  now: Date
): ApplyResult {
  const data: ContactUpdate = {};

  if (patch.email !== undefined && patch.email !== current.email) {
    data.email = patch.email;
    data.emailCapturedAt = patch.email === null ? null : now;
  }
  if (patch.phone !== undefined && patch.phone !== current.phone) {
    data.phone = patch.phone;
    data.phoneCapturedAt = patch.phone === null ? null : now;
  }

  if (patch.addTags?.length || patch.removeTags?.length) {
    const removed = new Set(patch.removeTags ?? []);
    const kept = current.tags.filter((tag) => !removed.has(tag));
    const nextTags = (patch.addTags ?? []).reduce<string[]>(
      (tags, tag) =>
        tags.some((t) => t.toLowerCase() === tag.toLowerCase()) ? tags : [...tags, tag],
      kept
    );
    if (nextTags.length > CONTACT_LIMITS.tagsTotal) {
      return { ok: false, error: `A contact can have at most ${CONTACT_LIMITS.tagsTotal} tags.` };
    }
    const changed =
      nextTags.length !== current.tags.length || nextTags.some((t, i) => t !== current.tags[i]);
    if (changed) data.tags = nextTags;
  }

  if (patch.unsetFields?.length || patch.setFields) {
    const unset = new Set(patch.unsetFields ?? []);
    const base = Object.fromEntries(
      Object.entries(parseCustomFields(current.customFields)).filter(([key]) => !unset.has(key))
    );
    const nextFields: Record<string, ContactFieldValue> = { ...base, ...(patch.setFields ?? {}) };
    if (Object.keys(nextFields).length > CONTACT_LIMITS.fieldsTotal) {
      return {
        ok: false,
        error: `A contact can have at most ${CONTACT_LIMITS.fieldsTotal} custom fields.`,
      };
    }
    data.customFields = nextFields;
  }

  return { ok: true, data };
}

/** First readable message out of a zod error, for the inline form error. */
export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request body";
  if (issue.code === "unrecognized_keys") return "Invalid request body";
  return issue.message || "Invalid request body";
}
