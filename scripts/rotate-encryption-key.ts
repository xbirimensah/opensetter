/**
 * Re-encrypt every stored Instagram token with the current ENCRYPTION_KEY.
 *
 * Rotation:
 *   1. Generate a new key: openssl rand -hex 32
 *   2. In .env: move the old ENCRYPTION_KEY into ENCRYPTION_KEYS_PREVIOUS
 *      (comma-separated if there are several) and set the new ENCRYPTION_KEY.
 *   3. Restart web + worker (old tokens keep working via the previous key).
 *   4. Run this script; when it reports 0 left, remove the old key from
 *      ENCRYPTION_KEYS_PREVIOUS and restart again.
 *
 * Usage (from the app folder, with its .env):
 *   npx tsx --env-file=.env --tsconfig ./tsconfig.json scripts/rotate-encryption-key.ts [--dry-run]
 */

import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken, needsReencryption } from "@/lib/meta/oauth";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const accounts = await prisma.instagramAccount.findMany({ select: { id: true, username: true, accessToken: true } });
  let rotated = 0;
  let failed = 0;
  for (const account of accounts) {
    if (!needsReencryption(account.accessToken)) continue;
    try {
      const plain = decryptToken(account.accessToken);
      if (!DRY_RUN) {
        await prisma.instagramAccount.update({ where: { id: account.id }, data: { accessToken: encryptToken(plain) } });
      }
      rotated += 1;
    } catch {
      failed += 1;
      console.error(`@${account.username}: could not decrypt with the current or previous keys`);
    }
  }
  const left = (await prisma.instagramAccount.findMany({ select: { accessToken: true } })).filter((a) =>
    needsReencryption(a.accessToken)
  ).length;
  console.log(`${DRY_RUN ? "Would re-encrypt" : "Re-encrypted"} ${rotated} token(s); ${failed} failed; ${left} left on an old key`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
