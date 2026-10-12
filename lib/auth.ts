import NextAuth, { type NextAuthConfig } from "next-auth";
import { audit } from "@/lib/audit";
import Credentials from "next-auth/providers/credentials";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db/client";
import { burnPasswordCheck, verifyPassword } from "@/lib/password";
import { clearAttempts, clientIp, registerAttempt } from "@/lib/login-throttle";
import { isEmailAllowedToSignIn } from "@/lib/signup-policy";
import { ensureWorkspaceForUser, getPrimaryWorkspace } from "@/lib/workspace";

type AdapterPrismaClient = Parameters<typeof PrismaAdapter>[0];

/** Sessions last 30 days and roll forward on use, so logging in is rare. */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Proof that a session refresh came from this server's password-change
 * route (via unstable_update), not from a client posting to
 * /api/auth/session: an HMAC over the user and the new password time.
 */
export function sessionRestampProof(userId: string, passwordUpdatedAt: Date): string {
  return createHmac("sha256", process.env.NEXTAUTH_SECRET ?? "")
    .update(`restamp:${userId}:${passwordUpdatedAt.getTime()}`)
    .digest("hex");
}

function proofMatches(given: unknown, expected: string): boolean {
  if (typeof given !== "string" || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export function normalizeLoginEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

/**
 * Email + password check. Only existing users who set a password in
 * Settings can log in this way; new people still arrive by invite or
 * email link, so there is no open signup.
 */
async function authorizePassword(
  raw: Partial<Record<"email" | "password", unknown>>,
  request?: Request
) {
  const email = normalizeLoginEmail(raw.email);
  const password = String(raw.password ?? "");
  if (!email || !password) return null;
  // Counted before any password work, per email and per IP.
  const ip = request ? clientIp(request.headers) : null;
  if (!(await registerAttempt("login", { email, ip }))) return null;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, image: true, passwordHash: true },
  });
  if (!user?.passwordHash) {
    await burnPasswordCheck(password);
    await audit({ action: "auth.password_login_failed", ip, level: "WARNING", detail: { email } });
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    await audit({ action: "auth.password_login_failed", actorUserId: user.id, ip, level: "WARNING", detail: { email } });
    return null;
  }
  await clearAttempts("login", email);
  await audit({ action: "auth.password_login", actorUserId: user.id, ip });
  return { id: user.id, email: user.email, name: user.name, image: user.image };
}

export const authConfig = {
  adapter: PrismaAdapter(prisma as unknown as AdapterPrismaClient),
  providers: [
    Credentials({
      id: "password",
      name: "Password",
      credentials: { email: {}, password: {} },
      authorize: authorizePassword,
    }),
    // Email links stay for first login, invites and a forgotten password.
    Resend({
      apiKey: process.env.RESEND_API_KEY ?? "missing-resend-api-key",
      from: process.env.EMAIL_FROM ?? "OpenSetter <login@example.com>",
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // Password logins only ever match an existing user (authorize).
      if (account?.provider !== "resend") return true;
      // No email link, and so no new account, for strangers.
      return isEmailAllowedToSignIn(user.email);
    },
    async jwt({ token, user, trigger, session }) {
      if (user?.id) {
        // Sign-in: remember when, so a later password change can end it.
        return { ...token, sub: user.id, authAt: Date.now() };
      }
      if (!token.sub) return null;
      // Sessions are checked against the database on every request (as the
      // database strategy did): a deleted user or a password changed after
      // this sign-in ends the session.
      const row = await prisma.user.findUnique({
        where: { id: token.sub },
        select: { passwordUpdatedAt: true },
      });
      if (!row) return null;
      if (
        trigger === "update" &&
        row.passwordUpdatedAt &&
        proofMatches(
          (session as { restamp?: unknown } | undefined)?.restamp,
          sessionRestampProof(token.sub, row.passwordUpdatedAt)
        )
      ) {
        // This device just changed the password: keep it signed in.
        return { ...token, authAt: Date.now() };
      }
      const authAt = typeof token.authAt === "number" ? token.authAt : 0;
      if (row.passwordUpdatedAt && row.passwordUpdatedAt.getTime() > authAt) return null;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (user.id) {
        await ensureWorkspaceForUser(user.id, user.email);
      }
    },
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/verify-request",
  },
  session: {
    // Password login (Credentials) only works with JWT sessions in Auth.js.
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET,
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth(authConfig);

export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const workspace = await getPrimaryWorkspace(userId);
  if (workspace) return workspace.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  const createdWorkspace = await ensureWorkspaceForUser(userId, user?.email);
  return createdWorkspace.id;
}
