"use client";

/**
 * Per-contact voice corrections. Each one applies only to drafts for
 * that contact. Edits made to held drafts land here automatically.
 */

import { useEffect, useState } from "react";
import { INPUT_CLASS, LABEL_CLASS, formatDateTime } from "./form";
import ContactPicker from "./contact-picker";
import { contactLabel, type PickerContact as Contact } from "@/lib/ai-setter/contact-filter";

interface Correction {
  id: string;
  kind: "EDIT" | "MANUAL";
  avoidText: string | null;
  preferText: string | null;
  note: string | null;
  createdAt: string;
  conversation: { participantId: string; participantUsername: string | null };
}

async function fetchCorrections(accountId: string): Promise<Correction[] | null> {
  try {
    const res = await fetch(`/api/ai-setter/corrections?instagramAccountId=${accountId}`, {
      cache: "no-store",
    });
    const data = await res.json();
    return data.success ? data.data.corrections : null;
  } catch {
    return null;
  }
}

async function fetchContacts(accountId: string): Promise<Contact[] | null> {
  try {
    const res = await fetch(`/api/ai-setter/conversations?instagramAccountId=${accountId}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (!data.success) return null;
    return (data.data.conversations as Contact[])
      .map((conversation) => ({
        participantId: conversation.participantId,
        participantUsername: conversation.participantUsername,
      }))
      .sort((a, b) => contactLabel(a).localeCompare(contactLabel(b)));
  } catch {
    return null;
  }
}

export default function VoiceCorrectionsCard({ accountId }: { accountId: string }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [participantId, setParticipantId] = useState("");
  const [avoidText, setAvoidText] = useState("");
  const [preferText, setPreferText] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchContacts(accountId), fetchCorrections(accountId)]).then(
      ([contactList, correctionList]) => {
        if (cancelled) return;
        if (contactList) setContacts(contactList);
        if (correctionList) setCorrections(correctionList);
        if (!contactList || !correctionList) setError("Could not load contacts or corrections");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  async function reloadCorrections() {
    const list = await fetchCorrections(accountId);
    if (list) setCorrections(list);
    else setError("Could not load corrections");
  }

  async function addCorrection() {
    if (saving || !participantId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-setter/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagramAccountId: accountId, participantId, avoidText, preferText, note }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Could not save the correction");
        return;
      }
      setAvoidText("");
      setPreferText("");
      setNote("");
      await reloadCorrections();
    } catch {
      setError("Could not save the correction");
    } finally {
      setSaving(false);
    }
  }

  async function removeCorrection(id: string) {
    setError(null);
    try {
      const res = await fetch(
        `/api/ai-setter/corrections?instagramAccountId=${accountId}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (data.success) setCorrections((prev) => prev.filter((item) => item.id !== id));
      else setError(data.error ?? "Could not remove the correction");
    } catch {
      setError("Could not remove the correction");
    }
  }

  const visible = participantId
    ? corrections.filter((item) => item.conversation.participantId === participantId)
    : corrections;
  const hasContent = Boolean(avoidText.trim() || preferText.trim() || note.trim());

  return (
    <section className="panel p-4 sm:p-5" aria-labelledby="corrections-heading">
      <h2 id="corrections-heading" className="section-title">
        Corrections per contact
      </h2>
      <p className="mt-1 text-footnote text-muted">
        Teach the setter how you talk with one specific person. A correction
        only affects drafts for that contact. Edits you make before approving
        a held draft are added here automatically.
      </p>

      <ContactPicker contacts={contacts} value={participantId} onChange={setParticipantId} />

      {participantId && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={LABEL_CLASS}>Don&apos;t say</span>
            <input
              value={avoidText}
              onChange={(e) => setAvoidText(e.target.value)}
              maxLength={500}
              placeholder="Hey! Wie geht's dir?"
              className={INPUT_CLASS}
            />
          </label>
          <label className="block">
            <span className={LABEL_CLASS}>Say instead</span>
            <input
              value={preferText}
              onChange={(e) => setPreferText(e.target.value)}
              maxLength={500}
              placeholder="yo was geht"
              className={INPUT_CLASS}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className={LABEL_CLASS}>Note (optional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="e.g. always English with him, we're on first-name terms"
              className={INPUT_CLASS}
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="button"
              onClick={() => void addCorrection()}
              disabled={saving || !hasContent}
              className="btn btn-primary w-full sm:w-auto"
            >
              {saving ? "Saving…" : "Add correction"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-error">{error}</p>}

      <ul className="mt-4 space-y-2">
        {visible.length === 0 ? (
          <li className="rounded-xl bg-fill px-3 py-4 text-center text-sm text-muted">
            No corrections yet.
          </li>
        ) : (
          visible.map((item) => (
            <li key={item.id} className="rounded-xl bg-fill px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 text-sm">
                  <p className="text-footnote text-faint">
                    {contactLabel(item.conversation)} ·{" "}
                    {item.kind === "EDIT" ? "from an edited draft" : "added by hand"} ·{" "}
                    {formatDateTime(item.createdAt)}
                  </p>
                  {item.avoidText && (
                    <p className="mt-1 break-words text-muted line-through decoration-error/60">
                      {item.avoidText}
                    </p>
                  )}
                  {item.preferText && (
                    <p className="mt-0.5 break-words text-foreground">{item.preferText}</p>
                  )}
                  {item.note && <p className="mt-0.5 break-words text-footnote text-muted">{item.note}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => void removeCorrection(item.id)}
                  aria-label="Remove correction"
                  className="btn btn-quiet btn-sm -mr-1 shrink-0 hover:text-error"
                >
                  Remove
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
