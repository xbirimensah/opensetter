/**
 * Applies reactions, edits and deletions from webhooks to the mirror.
 * Updates by mid are idempotent and silently skip unknown messages.
 */

import { prisma } from "@/lib/db/client";
import type { WebhookMessageUpdate } from "./webhook";

export async function applyMessageUpdates(updates: WebhookMessageUpdate[]): Promise<void> {
  for (const update of updates) {
    switch (update.type) {
      case "reaction":
        await prisma.dmMessage.updateMany({
          where: { mid: update.mid },
          data: { reaction: update.emoji },
        });
        break;
      case "edit":
        await prisma.dmMessage.updateMany({
          where: { mid: update.mid },
          data: { text: update.text, editedAt: new Date() },
        });
        break;
      case "delete":
        await prisma.dmMessage.updateMany({
          where: { mid: update.mid },
          data: { deletedAt: new Date() },
        });
        break;
    }
  }
}
