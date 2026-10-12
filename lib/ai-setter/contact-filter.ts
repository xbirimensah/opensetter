/**
 * Type-to-filter matching for the contact picker in "Corrections per
 * contact": every letter typed narrows the list, names that start with
 * the query come first, and typing a full name selects that contact.
 */

export interface PickerContact {
  participantId: string;
  participantUsername: string | null;
}

export function contactLabel(contact: PickerContact): string {
  return contact.participantUsername
    ? `@${contact.participantUsername}`
    : `user ${contact.participantId.slice(-6)}`;
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/^@/, "");
}

/** Contacts whose name contains the query; prefix matches first, input order kept. */
export function filterContacts<T extends PickerContact>(contacts: T[], query: string): T[] {
  const needle = normalize(query);
  if (!needle) return contacts;
  const prefix: T[] = [];
  const contains: T[] = [];
  for (const contact of contacts) {
    const name = normalize(contactLabel(contact));
    if (name.startsWith(needle)) prefix.push(contact);
    else if (name.includes(needle)) contains.push(contact);
  }
  return [...prefix, ...contains];
}

/** The contact whose full name was typed, if any. */
export function findContactByLabel<T extends PickerContact>(contacts: T[], text: string): T | null {
  const needle = normalize(text);
  if (!needle) return null;
  return contacts.find((contact) => normalize(contactLabel(contact)) === needle) ?? null;
}
