import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getRequestIp, hashClickIp } from "@/lib/tracking/server";

type FlowLinkRouteProps = {
  params: Promise<{ slug: string }>;
};

/** Link-preview bots open URLs too; they should not count as clicks. */
const PREVIEW_BOTS = /facebookexternalhit|facebot|instagram\.com\/bot|twitterbot|slackbot|whatsapp|telegrambot/i;

/**
 * Click tracker for URL buttons sent by flows. `c` is the conversation id
 * the link was sent to, so clicks count per contact and per step.
 */
export async function GET(request: NextRequest, { params }: FlowLinkRouteProps) {
  const { slug } = await params;
  const link = await prisma.flowLink.findUnique({
    where: { slug },
    select: { flowId: true, nodeId: true, buttonId: true, url: true },
  });
  if (!link) {
    return NextResponse.redirect(new URL("/", request.url), { status: 302 });
  }

  const userAgent = request.headers.get("user-agent") ?? "";
  if (!PREVIEW_BOTS.test(userAgent)) {
    const conversationParam = request.nextUrl.searchParams.get("c");
    const conversation = conversationParam && /^[a-z0-9]{20,40}$/.test(conversationParam)
      ? await prisma.dmConversation.findUnique({
          where: { id: conversationParam },
          select: { id: true },
        })
      : null;
    await prisma.flowEvent
      .create({
        data: {
          flowId: link.flowId,
          nodeId: link.nodeId,
          conversationId: conversation?.id ?? null,
          type: "CLICKED",
          detail: {
            buttonId: link.buttonId,
            url: true,
            ipHash: hashClickIp(getRequestIp(request)),
          },
        },
      })
      .catch(() => {});
  }

  // Only web links are followed (a flow button can't send people to javascript: or data:).
  if (!/^https?:\/\//i.test(link.url)) {
    return NextResponse.redirect(new URL("/", request.url), { status: 302 });
  }
  return NextResponse.redirect(link.url, { status: 302 });
}
