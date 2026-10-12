import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/client";
import { burnPasswordCheck, verifyPassword } from "@/lib/password";
import { clearLoginFailures, isLoginThrottled, recordLoginFailure } from "@/lib/login-throttle";
import { ensureWorkspaceForUser, getPrimaryWorkspace } from "@/lib/workspace";

type AdapterPrismaClient = Parameters<typeof PrismaAdapter>[0];

/** Sessions last 90 days and roll forward on use, so logging in is rare. */
const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export function normalizeLoginEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

/**
 * Email + password check. Only existing users who set a password in
 * Settings can log in this way; new people still arrive by invite or
 * email link, so there is no open signup.
 */
async function authorizePassword(raw: Partial<Record<"email" | "password", unknown>>) {
  const email = normalizeLoginEmail(raw.email);
  const password = String(raw.password ?? "");
  if (!email || !password) return null;
  // The login page checks this first to explain it; this is the backstop.
  if (await isLoginThrottled(email)) return null;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, image: true, passwordHash: true },
  });
  if (!user?.passwordHash) {
    await burnPasswordCheck(password);
    await recordLoginFailure(email);
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    await recordLoginFailure(email);
    return null;
  }
  await clearLoginFailures(email);
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
    async jwt({ token, user, trigger }) {
      if (user?.id) {
        // Sign-in: remember when, so a later password change can end it.
        return { ...token, sub: user.id, authAt: Date.now() };
      }
      if (trigger === "update") {
        // The user just changed their password on this device: keep it.
        return { ...token, authAt: Date.now() };
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
