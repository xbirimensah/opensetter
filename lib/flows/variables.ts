/**
 * {{variable}} rendering for flow texts, field values and webhook bodies.
 *
 * Supported: {{username}}, {{name}}, {{first_name}}, {{email}}, {{phone}},
 * {{field.<name>}}, {{last_input}}, {{comment}}, {{keyword}}, {{ref}}.
 * Unknown variables render as an empty string, never as raw braces.
 */

export interface FlowContact {
  conversationId: string;
  participantId: string;
  username: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  customFields: Record<string, string | number | boolean>;
  lastInput: string | null;
  lastInboundAt: Date | null;
  aiEnabled: boolean;
}

export interface VariableScope {
  contact: FlowContact;
  commentText?: string;
  keyword?: string;
  ref?: string;
}

const VARIABLE = /\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g;

export function resolveVariable(name: string, scope: VariableScope): string {
  const { contact } = scope;
  if (name.startsWith("field.")) {
    const value = contact.customFields[name.slice("field.".length)];
    return value === undefined || value === null ? "" : String(value);
  }
  switch (name) {
    case "username":
      return contact.username ?? "";
    case "name":
      return contact.name ?? contact.username ?? "";
    case "first_name":
      return (contact.name ?? contact.username ?? "").split(/\s+/)[0] ?? "";
    case "email":
      return contact.email ?? "";
    case "phone":
      return contact.phone ?? "";
    case "last_input":
      return contact.lastInput ?? "";
    case "comment":
      return scope.commentText ?? "";
    case "keyword":
      return scope.keyword ?? "";
    case "ref":
      return scope.ref ?? "";
    default:
      return "";
  }
}

/** Escape a value for use inside a JSON string literal. */
function jsonEscape(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

export function renderTemplate(
  template: string,
  scope: VariableScope,
  options: { json?: boolean } = {}
): string {
  return template.replace(VARIABLE, (_, name: string) => {
    const value = resolveVariable(name, scope);
    return options.json ? jsonEscape(value) : value;
  });
}

/** Default External Request body: the contact profile as JSON. */
export function contactPayload(scope: VariableScope, flow: { id: string; name: string }) {
  const { contact } = scope;
  return {
    flow: { id: flow.id, name: flow.name },
    contact: {
      instagram_id: contact.participantId,
      username: contact.username,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      tags: contact.tags,
      fields: contact.customFields,
      last_input: contact.lastInput,
    },
    trigger: {
      comment: scope.commentText ?? null,
      keyword: scope.keyword ?? null,
      ref: scope.ref ?? null,
    },
  };
}
