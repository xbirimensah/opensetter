import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, normalizeLoginEmail, signIn } from "@/lib/auth";
import { isLoginThrottled, LOGIN_THROTTLE_MINUTES } from "@/lib/login-throttle";
import { getCampaignTemplate } from "@/lib/templates/campaign-templates";

export const metadata = {
  title: "Login - OpenSetter",
  description: "Sign in to manage Instagram comment-to-DM campaigns.",
};

const ERRORS: Record<string, string> = {
  invalid: "That email and password don't match. Try again, or get a sign-in link below.",
  throttled: `Too many attempts. Wait ${LOGIN_THROTTLE_MINUTES} minutes, or get a sign-in link below.`,
};

const INPUT_CLASS =
  "w-full px-4 py-3 rounded bg-surface border border-border text-sm text-foreground placeholder:text-faint focus:border-accent/40 focus:outline-none transition-colors";

/** Only same-site paths, so the login form can't be used as an open redirect. */
function safeCallbackUrl(raw: string | undefined, fallback: string): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    checkEmail?: string;
    callbackUrl?: string;
    template?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const checkEmail = params.checkEmail === "1";
  const selectedTemplate = getCampaignTemplate(params.template);
  const templateCallbackUrl = selectedTemplate
    ? `/campaigns/new?template=${selectedTemplate.slug}`
    : null;
  const callbackUrl = safeCallbackUrl(params.callbackUrl, templateCallbackUrl ?? "/dashboard");
  const errorMessage = params.error ? ERRORS[params.error] ?? ERRORS.invalid : null;

  const session = await auth();
  if (session?.user?.id) redirect(callbackUrl);

  // Plain strings: inline server actions can only close over serializable values.
  const retryUrl = (error: string) => {
    const next = new URLSearchParams({ error, callbackUrl });
    if (selectedTemplate) next.set("template", selectedTemplate.slug);
    return `/login?${next.toString()}`;
  };
  const invalidUrl = retryUrl("invalid");
  const throttledUrl = retryUrl("throttled");

  async function passwordLogin(formData: FormData) {
    "use server";
    const email = normalizeLoginEmail(formData.get("email"));
    if (await isLoginThrottled(email)) redirect(throttledUrl);
    try {
      await signIn("password", {
        email,
        password: String(formData.get("password") ?? ""),
        redirectTo: callbackUrl,
      });
    } catch (error) {
      // A successful signIn throws Next's redirect, which must propagate.
      if (error instanceof AuthError) redirect(invalidUrl);
      throw error;
    }
  }

  async function sendMagicLink(formData: FormData) {
    "use server";
    await signIn("resend", {
      email: String(formData.get("email") ?? ""),
      redirectTo: callbackUrl,
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-foreground">
            OpenSetter
          </h1>
          <p className="text-muted text-sm leading-relaxed mt-2">
            {selectedTemplate
              ? `Sign in to use the ${selectedTemplate.title} template.`
              : "Sign in, then connect your Instagram professional account."}
          </p>
        </div>

        <div className="panel rounded p-8 shadow-black/40">
          {selectedTemplate && !checkEmail && (
            <div className="mb-5 border border-cyan-200/20 bg-cyan-300/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-100">
                Template selected
              </p>
              <p className="mt-2 text-sm font-semibold text-white">
                {selectedTemplate.title}
              </p>
            </div>
          )}

          {checkEmail ? (
            <div className="text-center py-4">
              <h2 className="text-lg font-semibold mb-2">Check your email</h2>
              <p className="text-sm text-muted">
                We sent you a secure sign-in link. Open it on this device to
                continue.
              </p>
            </div>
          ) : (
            <>
              <form action={passwordLogin} className="space-y-5">
                {errorMessage && (
                  <p role="alert" className="rounded border border-error/20 bg-error/10 px-4 py-3 text-sm text-error">
                    {errorMessage}
                  </p>
                )}
                <div className="space-y-2">
                  <label htmlFor="email" className="block text-sm font-medium text-foreground">
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="username"
                    placeholder="you@company.com"
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="password" className="block text-sm font-medium text-foreground">
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    className={INPUT_CLASS}
                  />
                </div>
                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-2 rounded bg-accent px-6 py-3.5 text-sm font-semibold text-white transition-all active:scale-[0.98]"
                >
                  Sign in
                </button>
              </form>

              <details className="mt-6 border-t border-border pt-5 group">
                <summary className="cursor-pointer list-none text-center text-sm text-muted hover:text-foreground">
                  First time here or forgot your password?{" "}
                  <span className="text-accent">Get a sign-in link</span>
                </summary>
                <form action={sendMagicLink} className="mt-5 space-y-4">
                  <label htmlFor="link-email" className="sr-only">
                    Email for the sign-in link
                  </label>
                  <input
                    id="link-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@company.com"
                    className={INPUT_CLASS}
                  />
                  <button
                    type="submit"
                    className="w-full inline-flex items-center justify-center rounded border border-border px-6 py-3 text-sm font-semibold text-foreground transition-all hover:border-border-hover active:scale-[0.98]"
                  >
                    Email me a sign-in link
                  </button>
                  <p className="text-xs text-faint text-center">
                    After signing in, set a password in Settings to skip the email next time.
                  </p>
                </form>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
