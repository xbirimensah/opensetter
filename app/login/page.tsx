import { headers } from "next/headers";
import { audit } from "@/lib/audit";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, normalizeLoginEmail, signIn } from "@/lib/auth";
import { clientIp, isThrottled, LOGIN_THROTTLE_MINUTES, registerAttempt } from "@/lib/login-throttle";
import { safeCallbackUrl } from "@/lib/safe-redirect";
import { getCampaignTemplate } from "@/lib/templates/campaign-templates";
import { ChevronRightIcon } from "@/components/nav-icons";

export const metadata = {
  title: "Login - OpenSetter",
  description: "Sign in to manage Instagram comment-to-DM campaigns.",
};

const ERRORS: Record<string, string> = {
  invalid: "That email and password don't match. Try again, or get a sign-in link below.",
  throttled: `Too many attempts. Wait ${LOGIN_THROTTLE_MINUTES} minutes, or get a sign-in link below.`,
};

const INPUT_CLASS = "field";

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
    // Explains a block up front; the attempt itself is counted in authorize.
    if (await isThrottled("login", { email, ip: clientIp(await headers()) })) redirect(throttledUrl);
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
    const email = normalizeLoginEmail(formData.get("email"));
    // Caps email sends per address and per IP (no mail bombing through us).
    if (!(await registerAttempt("magic-link", { email, ip: clientIp(await headers()) }))) {
      redirect(throttledUrl);
    }
    await audit({ action: "auth.email_link_requested", ip: clientIp(await headers()), detail: { email } });
    try {
      await signIn("resend", { email, redirectTo: callbackUrl });
    } catch (error) {
      // An address that may not sign in gets the same answer as one that
      // may, so this form can't be used to find out who has an account.
      if (error instanceof AuthError) redirect("/verify-request");
      throw error;
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-title-1 font-bold text-foreground">
            OpenSetter
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {selectedTemplate
              ? `Sign in to use the ${selectedTemplate.title} template.`
              : "Sign in, then connect your Instagram professional account."}
          </p>
        </div>

        <div className="panel p-6 sm:p-8">
          {selectedTemplate && !checkEmail && (
            <div className="mb-6 rounded-xl bg-accent/10 px-4 py-3">
              <p className="text-footnote font-semibold text-accent">Template selected</p>
              <p className="mt-0.5 text-sm font-semibold text-foreground">
                {selectedTemplate.title}
              </p>
            </div>
          )}

          {checkEmail ? (
            <div className="py-4 text-center">
              <h2 className="mb-2 text-title-3 font-semibold">Check your email</h2>
              <p className="text-sm text-muted">
                We sent you a secure sign-in link. Open it on this device to
                continue.
              </p>
            </div>
          ) : (
            <>
              <form action={passwordLogin} className="space-y-4">
                {errorMessage && (
                  <p role="alert" className="rounded-xl bg-error/12 px-4 py-3 text-sm text-error">
                    {errorMessage}
                  </p>
                )}
                <div className="space-y-1.5">
                  <label htmlFor="email" className="field-label">
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
                <div className="space-y-1.5">
                  <label htmlFor="password" className="field-label">
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
                  className="btn btn-primary mt-2 min-h-11 w-full"
                >
                  Sign in
                </button>
              </form>

              <details className="group mt-6 border-t border-border pt-5">
                <summary className="cursor-pointer list-none text-center text-sm text-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
                  First time here or forgot your password?{" "}
                  <span className="inline-flex items-center gap-0.5 font-medium text-accent">
                    Get a sign-in link
                    <ChevronRightIcon
                      size={14}
                      className="transition-transform duration-200 group-open:rotate-90"
                    />
                  </span>
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
                    className="btn btn-secondary min-h-11 w-full"
                  >
                    Email me a sign-in link
                  </button>
                  <p className="text-center text-caption text-faint">
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
