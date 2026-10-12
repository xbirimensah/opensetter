import { redirect } from "next/navigation";
import CampaignBuilder from "@/components/campaign-builder";
import { campaignNewRedirect } from "@/lib/flows/template-flow";

/**
 * New comment automations are flows now. Old links keep working:
 * ?template=<slug> (public template pages, through login) opens a new
 * flow built from that template, ?flowId= opens the flow with a new
 * comment trigger. Only the classic CSV import (?import=1) still uses the
 * campaign builder.
 */
export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const target = campaignNewRedirect(await searchParams);
  if (target) redirect(target);
  return <CampaignBuilder mode="new" />;
}
