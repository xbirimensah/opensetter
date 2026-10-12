import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import InvitationAcceptCard from "@/components/invitation-accept-card";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

type InvitePageProps = {
  params: Promise<{ token: string }>;
};

export const metadata: Metadata = {
  title: "Accept Workspace Invitation - OpenSetter",
  robots: { index: false, follow: false },
};

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const [session, invitation] = await Promise.all([
    auth(),
    prisma.workspaceInvitation.findUnique({
      where: { token },
      include: {
        workspace: { select: { name: true } },
      },
    }),
  ]);

  if (!invitation || invitation.status !== "PENDING") {
    notFound();
  }

  const expired = invitation.expiresAt <= new Date();

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
        <Link
          href="/"
          className="press mb-8 self-center text-[1.0625rem] font-bold tracking-[-0.02em] text-foreground active:opacity-70"
        >
          OpenSetter
        </Link>
        <section className="panel p-6 sm:p-8">
          <p className="text-footnote font-semibold text-accent">Workspace invitation</p>
          <h1 className="mt-2 text-title-1 font-bold text-foreground">
            Join {invitation.workspace.name}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            You were invited as {invitation.role.toLowerCase()} for{" "}
            <span className="font-medium text-foreground">{invitation.email}</span>.
          </p>
          <div className="mt-8">
            {expired ? (
              <p role="alert" className="rounded-xl bg-error/12 px-4 py-3 text-sm text-error">
                This invitation has expired. Ask the workspace owner to resend it.
              </p>
            ) : (
              <InvitationAcceptCard
                token={token}
                isSignedIn={Boolean(session?.user?.id)}
                invitedEmail={invitation.email}
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
