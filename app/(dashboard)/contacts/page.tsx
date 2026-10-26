"use client";

/**
 * Contacts
 *
 * Everyone who messaged a connected account, with what flows and the
 * inbox learned about them (email, phone, tags, custom fields). Filters
 * by text, tag and field, exports the filtered list as CSV, and opens a
 * contact's conversation in the inbox.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/nav-icons";
import { SearchIcon } from "@/components/inbox/icons";
import { contactFilterParams, type ContactFilter } from "@/lib/inbox/filters";
import type { ContactRow } from "@/lib/inbox/contacts-list";

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Filters {
  q: string;
  tag: string;
  hasEmail: boolean;
  hasPhone: boolean;
  fieldKey: string;
  fieldValue: string;
}

const EMPTY_FILTERS: Filters = { q: "", tag: "", hasEmail: false, hasPhone: false, fieldKey: "", fieldValue: "" };
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

function toContactFilter(filters: Filters): ContactFilter {
  return {
    q: filters.q.trim() || undefined,
    tag: filters.tag || undefined,
    hasEmail: filters.hasEmail || undefined,
    hasPhone: filters.hasPhone || undefined,
    field:
      filters.fieldKey && filters.fieldValue.trim()
        ? { key: filters.fieldKey, value: filters.fieldValue.trim() }
        : undefined,
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

function handle(contact: ContactRow): string {
  return contact.username ? `@${contact.username}` : `ID ${contact.participantId.slice(0, 8)}`;
}

function inboxHref(contact: ContactRow, accountId: string): string {
  return `/inbox?account=${encodeURIComponent(accountId)}&contact=${encodeURIComponent(contact.participantId)}`;
}

function FieldList({ fields }: { fields: ContactRow["customFields"] }) {
  const entries = Object.entries(fields);
  if (entries.length === 0) return <span className="text-faint">–</span>;
  return (
    <span className="block truncate" title={entries.map(([k, v]) => `${k}: ${v}`).join("\n")}>
      {entries.map(([k, v]) => `${k}: ${v}`).join(" · ")}
    </span>
  );
}

function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <span className="text-faint">–</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span key={tag} className="rounded-full bg-fill px-2 py-0.5 text-caption text-muted">
          #{tag}
        </span>
      ))}
    </span>
  );
}

export default function ContactsPage() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [fieldKeys, setFieldKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/instagram/accounts")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        const list: AccountOption[] = payload.data.instagramAccounts ?? [];
        setAccounts(list);
        setAccountId(payload.data.selectedInstagramAccountId || list[0]?.id || "");
        if (list.length === 0) setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Typing waits for a pause; the other filters apply at once.
  useEffect(() => {
    const next = contactFilterParams(toContactFilter(filters)).toString();
    if (next === query) return;
    const timer = window.setTimeout(() => {
      setQuery(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [filters, query]);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams(query);
      params.set("instagramAccountId", accountId);
      params.set("page", String(page));
      params.set("limit", String(PAGE_SIZE));
      const res = await fetch(`/api/contacts?${params}`, { cache: "no-store" });
      const payload = await res.json();
      if (!payload.success) {
        setError(payload.error ?? "Failed to load contacts");
        return;
      }
      setContacts(payload.data.contacts);
      setPagination(payload.data.pagination);
      setTags(payload.data.availableTags);
      setFieldKeys(payload.data.fieldKeys);
      setError(null);
    } catch {
      setError("Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, [accountId, query, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const exportHref = accountId
    ? `/api/contacts/export?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(query)), instagramAccountId: accountId })}`
    : undefined;
  const update = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));
  const showEmpty = !loading && !error && contacts.length === 0;
  const filtered = query !== "";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:max-w-3xl lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
          <label className="relative block">
            <span className="sr-only">Search contacts</span>
            <SearchIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              type="search"
              value={filters.q}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="Search name, email or phone"
              maxLength={100}
              className="field pl-9"
            />
          </label>
          <select value={filters.tag} onChange={(e) => update({ tag: e.target.value })} aria-label="Tag" className="field">
            <option value="">Any tag</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                #{tag}
              </option>
            ))}
          </select>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
            <select
              value={filters.fieldKey}
              onChange={(e) => update({ fieldKey: e.target.value })}
              aria-label="Custom field"
              className="field min-w-0 flex-1"
            >
              <option value="">Any field</option>
              {fieldKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
            {filters.fieldKey && (
              <input
                value={filters.fieldValue}
                onChange={(e) => update({ fieldValue: e.target.value })}
                placeholder="equals"
                aria-label="Field value"
                maxLength={200}
                className="field min-w-0 flex-1"
              />
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["hasEmail", "hasPhone"] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filters[key]}
              onClick={() => update({ [key]: !filters[key] })}
              className={`btn btn-sm ${filters[key] ? "bg-foreground text-background" : "btn-secondary text-muted hover:text-foreground"}`}
            >
              {key === "hasEmail" ? "Has email" : "Has phone"}
            </button>
          ))}
          {accounts.length > 1 && (
            <AccountSelect
              accounts={accounts}
              value={accountId}
              onChange={(id) => {
                setAccountId(id);
                setPage(1);
              }}
              includeAll={false}
              hideLabel
            />
          )}
          <a
            href={exportHref}
            aria-disabled={!exportHref || contacts.length === 0}
            className={`btn btn-primary btn-sm ${!exportHref || contacts.length === 0 ? "pointer-events-none opacity-50" : ""}`}
          >
            Export CSV
          </a>
        </div>
      </div>

      <div className="panel overflow-hidden" aria-busy={loading}>
        {error && (
          <p role="alert" className="px-5 py-6 text-sm text-error">
            {error}
          </p>
        )}

        {/* Table from md up */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-caption text-faint">
                <th scope="col" className="py-3 pl-5 pr-4 font-medium">Contact</th>
                <th scope="col" className="px-4 py-3 font-medium">Email</th>
                <th scope="col" className="px-4 py-3 font-medium">Phone</th>
                <th scope="col" className="px-4 py-3 font-medium">Tags</th>
                <th scope="col" className="px-4 py-3 font-medium">Fields</th>
                <th scope="col" className="py-3 pl-4 pr-5 text-right font-medium">Last message</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-t border-border">
                    <td colSpan={6} className="px-5 py-4">
                      <div className="skeleton h-4" />
                    </td>
                  </tr>
                ))}
              {showEmpty && (
                <tr className="border-t border-border">
                  <td colSpan={6} className="px-5 py-14 text-center text-muted">
                    {filtered ? "No contacts match these filters." : "No contacts yet. Everyone who messages you shows up here."}
                  </td>
                </tr>
              )}
              {!loading &&
                contacts.map((contact) => (
                  <tr key={contact.conversationId} className="border-t border-border hover:bg-surface-hover">
                    <td className="py-3 pl-5 pr-4">
                      <Link href={inboxHref(contact, accountId)} className="font-medium text-foreground hover:underline">
                        {handle(contact)}
                      </Link>
                      {contact.activeFlow && (
                        <span className="block truncate text-caption text-faint">In flow: {contact.activeFlow}</span>
                      )}
                    </td>
                    <td className="max-w-[14rem] px-4 py-3 text-muted">
                      <span className="block truncate">{contact.email ?? "–"}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{contact.phone ?? "–"}</td>
                    <td className="max-w-[14rem] px-4 py-3">
                      <Tags tags={contact.tags} />
                    </td>
                    <td className="max-w-[16rem] px-4 py-3 text-muted">
                      <FieldList fields={contact.customFields} />
                    </td>
                    <td className="whitespace-nowrap py-3 pl-4 pr-5 text-right tabular-nums text-faint">
                      {formatDate(contact.lastInboundAt ?? contact.lastOutboundAt)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Rows on phones */}
        <ul className="md:hidden">
          {loading &&
            [...Array(6)].map((_, i) => (
              <li key={i} className={`space-y-2 px-4 py-3.5 ${i > 0 ? "border-t border-border" : ""}`}>
                <div className="skeleton h-4 w-32" />
                <div className="skeleton h-3.5 w-52" />
              </li>
            ))}
          {showEmpty && (
            <li className="px-4 py-14 text-center text-sm text-muted">
              {filtered ? "No contacts match these filters." : "No contacts yet."}
            </li>
          )}
          {!loading &&
            contacts.map((contact, index) => (
              <li key={contact.conversationId} className={index > 0 ? "border-t border-border" : ""}>
                <Link href={inboxHref(contact, accountId)} className="block px-4 py-3 active:bg-fill">
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{handle(contact)}</span>
                    <span className="shrink-0 text-caption tabular-nums text-faint">
                      {formatDate(contact.lastInboundAt ?? contact.lastOutboundAt)}
                    </span>
                  </span>
                  {(contact.email || contact.phone) && (
                    <span className="mt-0.5 block truncate text-footnote text-muted">
                      {[contact.email, contact.phone].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  {contact.tags.length > 0 && (
                    <span className="mt-1 block">
                      <Tags tags={contact.tags} />
                    </span>
                  )}
                </Link>
              </li>
            ))}
        </ul>

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
            <p className="text-footnote tabular-nums text-muted">
              {(pagination.page - 1) * pagination.limit + 1}–
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                aria-label="Previous page"
                className="btn btn-quiet btn-sm px-2.5"
              >
                <ChevronLeftIcon size={16} />
                <span className="hidden sm:inline">Previous</span>
              </button>
              <span className="px-2 text-footnote tabular-nums text-muted">
                {page} / {pagination.totalPages}
              </span>
              <button
                type="button"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage(page + 1)}
                aria-label="Next page"
                className="btn btn-quiet btn-sm px-2.5"
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRightIcon size={16} />
              </button>
            </div>
          </div>
        )}
        {pagination && pagination.total > 0 && pagination.totalPages <= 1 && (
          <p className="border-t border-border px-4 py-3 text-footnote tabular-nums text-muted sm:px-5">
            {pagination.total} {pagination.total === 1 ? "contact" : "contacts"}
          </p>
        )}
      </div>
    </div>
  );
}
