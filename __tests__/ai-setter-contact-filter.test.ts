/**
 * Corrections per contact - type-to-filter contact picker
 *
 * Every letter typed narrows the list; prefix matches come first and an
 * exact name selects the contact.
 */

import { describe, it, expect } from "vitest";
import {
  contactLabel,
  filterContacts,
  findContactByLabel,
  type PickerContact,
} from "../lib/ai-setter/contact-filter";

const CONTACTS: PickerContact[] = [
  { participantId: "1001", participantUsername: "anna.coaching" },
  { participantId: "1002", participantUsername: "jonas_mindset" },
  { participantId: "1003", participantUsername: "marius.berg" },
  { participantId: "1004", participantUsername: "mariana" },
  { participantId: "9876543210", participantUsername: null },
];

describe("contactLabel", () => {
  it("shows the handle, or the id tail when there is none", () => {
    expect(contactLabel(CONTACTS[0])).toBe("@anna.coaching");
    expect(contactLabel(CONTACTS[4])).toBe("user 543210");
  });
});

describe("filterContacts", () => {
  it("lists every contact while the field is empty", () => {
    expect(filterContacts(CONTACTS, "")).toHaveLength(5);
    expect(filterContacts(CONTACTS, "   ")).toHaveLength(5);
  });

  it("narrows the list with every letter typed", () => {
    const counts = ["m", "ma", "mar", "mari", "mariu"].map((query) => filterContacts(CONTACTS, query).length);
    expect(counts).toEqual([3, 2, 2, 2, 1]);
  });

  it("ignores case and a leading @", () => {
    expect(filterContacts(CONTACTS, "@JONAS").map((c) => c.participantId)).toEqual(["1002"]);
  });

  it("puts names that start with the query before names that only contain it", () => {
    expect(filterContacts(CONTACTS, "an").map((c) => c.participantId)).toEqual(["1001", "1004"]);
    expect(filterContacts(CONTACTS, "min").map((c) => c.participantId)).toEqual(["1002"]);
    expect(filterContacts(CONTACTS, "a").map((c) => c.participantId).slice(0, 1)).toEqual(["1001"]);
  });

  it("finds a contact without a handle by its id tail", () => {
    expect(filterContacts(CONTACTS, "543").map((c) => c.participantId)).toEqual(["9876543210"]);
  });

  it("returns nothing when no contact matches", () => {
    expect(filterContacts(CONTACTS, "zzz")).toEqual([]);
  });
});

describe("findContactByLabel", () => {
  it("selects a contact when the full name is typed, with or without @", () => {
    expect(findContactByLabel(CONTACTS, "marius.berg")?.participantId).toBe("1003");
    expect(findContactByLabel(CONTACTS, "@Marius.Berg ")?.participantId).toBe("1003");
  });

  it("does not select on a partial name", () => {
    expect(findContactByLabel(CONTACTS, "marius")).toBeNull();
    expect(findContactByLabel(CONTACTS, "")).toBeNull();
  });
});
