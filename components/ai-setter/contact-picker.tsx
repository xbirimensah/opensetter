"use client";

/**
 * Type-to-filter contact field for "Corrections per contact". Every
 * letter typed narrows the list; clicking a name, Enter, or typing a full
 * name selects that contact. An empty field means all contacts.
 */

import { useEffect, useId, useState } from "react";
import { LABEL_CLASS } from "./form";
import {
  contactLabel,
  filterContacts,
  findContactByLabel,
  type PickerContact,
} from "@/lib/ai-setter/contact-filter";

export default function ContactPicker({
  contacts,
  value,
  onChange,
}: {
  contacts: PickerContact[];
  value: string;
  onChange: (participantId: string) => void;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const selected = contacts.find((contact) => contact.participantId === value) ?? null;
  const [query, setQuery] = useState(selected ? contactLabel(selected) : "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  // With a contact picked, reopening the list shows everyone so it is easy to switch.
  const showsSelection = selected !== null && query === contactLabel(selected);
  const matches = filterContacts(contacts, showsSelection ? "" : query);
  const activeIndex = Math.min(active, matches.length - 1);
  const activeId = open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  function type(text: string) {
    setQuery(text);
    setOpen(true);
    setActive(0);
    onChange(findContactByLabel(contacts, text)?.participantId ?? "");
  }

  function pick(contact: PickerContact) {
    setQuery(contactLabel(contact));
    setOpen(false);
    onChange(contact.participantId);
  }

  function clear() {
    setQuery("");
    setActive(0);
    onChange("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive(Math.min(activeIndex + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (event.key === "Enter" && open && matches[activeIndex]) {
      event.preventDefault();
      pick(matches[activeIndex]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="relative mt-4">
      <label htmlFor={id} className={LABEL_CLASS}>
        Contact
      </label>
      <div className="relative mt-1.5">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={query}
          placeholder="Type a name, or leave empty for all contacts"
          onChange={(e) => type(e.target.value)}
          onFocus={(e) => {
            e.target.select();
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
          className={`field ${query ? "pr-20" : ""}`}
        />
        {query && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
            aria-label="Clear contact"
            className="btn btn-quiet btn-sm absolute right-1.5 top-1/2 -translate-y-1/2"
          >
            Clear
          </button>
        )}
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Contacts"
          className="absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface-raised py-1 shadow-xl"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-muted">No contact matches &ldquo;{query.trim()}&rdquo;</li>
          ) : (
            matches.map((contact, index) => (
              <li
                key={contact.participantId}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={contact.participantId === value}
                // Keep focus in the field so the click lands before the blur closes the list.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(contact)}
                onMouseMove={() => setActive(index)}
                className={`cursor-pointer truncate px-3 py-2.5 text-sm sm:py-2 ${
                  index === activeIndex ? "bg-surface-hover text-foreground" : "text-foreground"
                } ${contact.participantId === value ? "font-medium" : ""}`}
              >
                {contactLabel(contact)}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
