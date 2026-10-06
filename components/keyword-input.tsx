"use client";

/**
 * Keyword Input
 *
 * Tag-style input for adding/removing keywords.
 */

import { useState, type KeyboardEvent } from "react";

interface KeywordInputProps {
  keywords: string[];
  onChange: (keywords: string[]) => void;
  max?: number;
}

export default function KeywordInput({ keywords, onChange, max = 10 }: KeywordInputProps) {
  const [input, setInput] = useState("");

  function addKeyword(value: string) {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed) return;
    if (keywords.includes(trimmed)) return;
    if (keywords.length >= max) return;
    onChange([...keywords, trimmed]);
    setInput("");
  }

  function removeKeyword(keyword: string) {
    onChange(keywords.filter((k) => k !== keyword));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addKeyword(input);
    }
    if (e.key === "Backspace" && !input && keywords.length > 0) {
      removeKeyword(keywords[keywords.length - 1]);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 p-3 rounded bg-surface border border-border min-h-[48px]">
        {keywords.map((keyword) => (
          <span
            key={keyword}
            className="inline-flex max-w-full items-center gap-2 px-2 py-1 rounded border border-border text-xs"
          >
            <span className="min-w-0 break-all">{keyword}</span>
            <button
              type="button"
              onClick={() => removeKeyword(keyword)}
              aria-label={`Remove ${keyword}`}
              className="-my-1 inline-flex min-h-11 shrink-0 items-center text-muted hover:text-error sm:my-0 sm:min-h-0"
            >
              Remove
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={keywords.length === 0 ? "Type keyword and press Enter..." : ""}
          className="flex-1 min-w-[120px] min-h-11 bg-transparent text-base text-foreground placeholder:text-faint outline-none sm:min-h-0 sm:text-sm"
        />
      </div>
      <p className="text-xs text-muted">
        {keywords.length}/{max} keywords · Press Enter or comma to add
      </p>
    </div>
  );
}
