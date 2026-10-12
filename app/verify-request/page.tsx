import Link from "next/link";

export const metadata = {
  title: "Check your email - OpenSetter",
  description: "A sign-in link was sent to your email.",
};

export default function VerifyRequestPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-title-1 font-bold text-foreground">
            OpenSetter
          </h1>
        </div>

        <div className="panel p-6 text-center sm:p-8">
          <h2 className="mb-2 text-title-3 font-semibold">Check your email</h2>
          <p className="text-sm text-muted">
            We sent you a secure sign-in link. Open it on this device to
            continue.
          </p>
          <p className="mt-6">
            <Link href="/login" className="btn btn-secondary">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
