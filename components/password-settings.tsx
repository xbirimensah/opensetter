"use client";

/**
 * Settings section to set or change the login password. Without one, the
 * user signs in by email link; with one, email + password is enough.
 */

import { useEffect, useState } from "react";

const MIN_LENGTH = 10;

const INPUT_CLASS = "field";

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
    <section aria-labelledby="settings-password">
      <h2 id="settings-password" className="section-title mb-2.5 px-1">
        Password
      </h2>
      <div className="panel p-4 sm:p-5">
        <p className="mb-5 text-sm text-muted">
          {hasPassword
            ? "You sign in with your email and this password. Changing it signs you out on other devices."
            : "Set a password to sign in with email and password instead of waiting for an email link."}
        </p>

        <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
          {/* Lets password managers file the new password under the right account. */}
          <input type="email" name="username" autoComplete="username" value={email} hidden readOnly />
          {hasPassword && (
            <div className="space-y-1.5">
              <label htmlFor="current-password" className="field-label">
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
          <div className="space-y-1.5">
            <label htmlFor="new-password" className="field-label">
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
            <p id="new-password-hint" className={`text-footnote ${tooShort ? "text-error" : "text-faint"}`}>
              At least {MIN_LENGTH} characters.
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="confirm-password" className="field-label">
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
            {mismatch && <p className="text-footnote text-error">The two passwords don&apos;t match.</p>}
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
            className="btn btn-primary min-h-11 w-full sm:min-h-10 sm:w-auto"
          >
            {busy ? "Saving…" : hasPassword ? "Change password" : "Set password"}
          </button>
        </form>
      </div>
    </section>
  );
}
