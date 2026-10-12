/**
 * Set a login password from the server's shell, for the first login after
 * an upgrade or when email links aren't configured. The password is read
 * without echo and never logged. Only existing users can be updated.
 *
 * Usage (from the app folder, with its .env):
 *   npx tsx --env-file=.env --tsconfig ./tsconfig.json scripts/set-password.ts you@example.com
 */

import { createInterface } from "readline";
import { Writable } from "stream";
import { prisma } from "@/lib/db/client";
import { hashPassword, passwordProblem } from "@/lib/password";

function askHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!email) throw new Error("Usage: scripts/set-password.ts you@example.com");

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`No user with the email ${email}. Sign in once by email link first.`);

  const password = await askHidden("New password: ");
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  if ((await askHidden("Repeat it: ")) !== password) throw new Error("The two passwords don't match.");

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), passwordUpdatedAt: new Date() },
  });
  console.log(`Password set for ${email}. Other sessions of this user are signed out.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
