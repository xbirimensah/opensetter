/**
 * Fill the local mirror with each account's recent threads (up to 50) and
 * their latest messages, without triggering the AI setter or flows. The
 * inbox reads the mirror, so run this once after deploying rich mirroring.
 *
 *   npx tsx --env-file=.env scripts/backfill-mirror.ts
 */

import { prisma } from "@/lib/db/client";
import { backfillMirror } from "@/lib/polling/dm-reconciler";

backfillMirror(50)
  .then((stats) => console.log(`Backfilled ${stats.backfilled} message(s) across ${stats.accounts} account(s)`))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
