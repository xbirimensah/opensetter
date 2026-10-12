import { redirect } from "next/navigation";
import CampaignBuilder from "@/components/campaign-builder";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

/**
 * Classic campaigns open the campaign builder. A campaign that runs a flow
 * is that flow's comment trigger, so it is edited in the flow editor.
 */
export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspaceId = await getCurrentWorkspaceId();
  if (workspaceId) {
    const campaign = await prisma.automation.findFirst({
      where: { id, workspaceId },
      select: { flowId: true },
    });
    if (campaign?.flowId) redirect(`/flows/${campaign.flowId}?trigger=${encodeURIComponent(id)}`);
  }
  return <CampaignBuilder mode="edit" campaignId={id} />;
}
