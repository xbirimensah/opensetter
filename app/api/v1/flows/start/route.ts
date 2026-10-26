import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { authenticateApiRequest } from "@/lib/integrations/api-keys";
import { firstIssueMessage } from "@/lib/inbox/contact";
import { startFlowForConversation } from "@/lib/flows/service";
import { FlowLockBusyError } from "@/lib/flows/lock";
import { apiError, contactRefSchema, findContactConversation, hasContactRef } from "@/lib/integrations/v1";

const bodySchema = z.object({
  flowId: z.string().min(1).max(64),
  contact: contactRefSchema.omit({ instagramAccountId: true }),
});

/**
 * Start an active flow for a contact. Instagram only allows messages
 * within 24 hours of the contact's last message, so a contact outside
 * that window gets 409 and nothing is sent.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Send a JSON body");
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return apiError(400, firstIssueMessage(parsed.error));
  if (!hasContactRef(parsed.data.contact)) return apiError(400, "contact: pass contactId, username or email");

  const flow = await prisma.flow.findFirst({
    where: { id: parsed.data.flowId, workspaceId: auth.caller.workspaceId },
    select: {
      id: true,
      status: true,
      instagramAccount: { select: { id: true, instagramId: true, workspaceId: true, accessToken: true } },
    },
  });
  if (!flow) return apiError(404, "Flow not found");
  if (flow.status !== "ACTIVE") return apiError(409, "The flow is not active; publish it first");

  const conversationId = await findContactConversation(flow.instagramAccount.id, parsed.data.contact);
  if (!conversationId) return apiError(404, "Contact not found (they appear once they message the account)");

  try {
    const state = await startFlowForConversation({
      account: flow.instagramAccount,
      conversationId,
      flowId: flow.id,
      context: { trigger: "api" },
    });
    if (!state) return apiError(409, "The flow could not start");
    if (state.status === "EXPIRED") {
      return apiError(409, "Outside Instagram's 24h messaging window: the contact has to message you first");
    }
    if (state.status === "FAILED") return apiError(502, state.lastError ?? "The flow failed");
    return NextResponse.json({
      success: true,
      data: { runId: state.id, status: state.status, messagesSent: state.sends },
    });
  } catch (error) {
    if (error instanceof FlowLockBusyError) return apiError(409, "The contact is busy in another flow step; retry shortly");
    console.error("[api/v1] flow start failed:", error);
    return apiError(500, "Could not start the flow");
  }
}
