"use client";

/**
 * Settings section to set or change the login password. Without one, the
 * user signs in by email link; with one, email + password is enough.
 */

import { useEffect, useState } from "react";

const MIN_LENGTH = 10;

const INPUT_CLASS =
  "w-full px-4 py-2.5 rounded bg-surface border border-border text-sm text-foreground focus:border-accent/40 focus:outline-none transition-colors";

export default function PasswordSettings() {
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/account/password")
      .then((res) => res.json())
      .then((payload) => {
        if (!payload.success) return;
        setHasPassword(payload.data.hasPassword);
        setEmail(payload.data.email ?? "");
      })
      .catch(() => setHasPassword(false));
  }, []);

  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < MIN_LENGTH;
  const canSubmit =
    !busy &&
    newPassword.length >= MIN_LENGTH &&
    newPassword === confirmPassword &&
    (!hasPassword || currentPassword.length > 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: hasPassword ? currentPassword : undefined, newPassword }),
      });
      const payload = await res.json();
      if (!payload.success) {
        setError(payload.error ?? "Could not save the password.");
        return;
      }
      setHasPassword(true);
      setSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel rounded p-6">
      <h2 className="text-base font-semibold mb-2">Password</h2>
      <p className="text-sm text-muted mb-6">
        {hasPassword
          ? "You sign in with your email and this password. Changing it signs you out on other devices."
          : "Set a password to sign in with email and password instead of waiting for an email link."}
      </p>

      <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
        {/* Lets password managers file the new password under the right account. */}
        <input type="email" name="username" autoComplete="username" value={email} hidden readOnly />
        {hasPassword && (
          <div className="space-y-2">
            <label htmlFor="current-password" className="block text-sm font-medium">
              Current password
            </label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        )}
        <div className="space-y-2">
          <label htmlFor="new-password" className="block text-sm font-medium">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            aria-describedby="new-password-hint"
            className={INPUT_CLASS}
          />
          <p id="new-password-hint" className={`text-xs ${tooShort ? "text-error" : "text-faint"}`}>
            At least {MIN_LENGTH} characters.
          </p>
        </div>
        <div className="space-y-2">
          <label htmlFor="confirm-password" className="block text-sm font-medium">
            Repeat new password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            aria-invalid={mismatch}
            className={INPUT_CLASS}
          />
          {mismatch && <p className="text-xs text-error">The two passwords don&apos;t match.</p>}
        </div>

        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-success">
            Password saved. Next time, sign in with your email and this password.
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center justify-center rounded bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? "Saving..." : hasPassword ? "Change password" : "Set password"}
        </button>
      </form>
    </section>
  );
}
