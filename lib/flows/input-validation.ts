import type { FlowInputType } from "./types";

/** Result of checking a contact's answer to an input step. */
export type InputCheck = { ok: true; value: string } | { ok: false };

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-zA-Z]{2,}$/;

/** Pulls the first email out of a message ("sure: max@x.de thanks"). */
export function extractEmail(text: string): string | null {
  const match = text.match(/[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-zA-Z]{2,}/);
  if (!match) return null;
  const email = match[0].replace(/[.!?]+$/, "").toLowerCase();
  return EMAIL.test(email) && email.length <= 254 ? email : null;
}

export function normalizePhone(text: string): string | null {
  const trimmed = text.trim();
  const hasPlus = trimmed.startsWith("+") || trimmed.startsWith("00");
  const digits = trimmed.replace(/[^\d]/g, "").replace(/^00/, "");
  if (digits.length < 7 || digits.length > 15) return null;
  // Only accept text that is mostly a phone number, not a sentence with digits.
  if (trimmed.replace(/[\d\s()+\-./]/g, "").length > 3) return null;
  return hasPlus ? `+${digits}` : digits;
}

export function checkInput(type: FlowInputType, raw: string): InputCheck {
  const text = raw.trim();
  if (!text) return { ok: false };

  switch (type) {
    case "email": {
      const email = extractEmail(text);
      return email ? { ok: true, value: email } : { ok: false };
    }
    case "phone": {
      const phone = normalizePhone(text);
      return phone ? { ok: true, value: phone } : { ok: false };
    }
    case "number": {
      const normalized = text.replace(/\s/g, "").replace(",", ".");
      return /^-?\d+(\.\d+)?$/.test(normalized)
        ? { ok: true, value: normalized }
        : { ok: false };
    }
    case "url": {
      const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`;
      try {
        const url = new URL(candidate);
        return url.hostname.includes(".") ? { ok: true, value: url.toString() } : { ok: false };
      } catch {
        return { ok: false };
      }
    }
    case "text":
      return { ok: true, value: text.slice(0, 1000) };
  }
}

export const DEFAULT_RETRY_MESSAGES: Record<FlowInputType, string> = {
  email: "That doesn't look like an email address. Could you send it again?",
  phone: "That doesn't look like a phone number. Could you send it again?",
  number: "Please send a number.",
  url: "Please send a valid link.",
  text: "Could you send that again?",
};
