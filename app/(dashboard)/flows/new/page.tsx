import { NewFlowStarter } from "@/components/flows/new-flow-starter";
import { getCampaignTemplate } from "@/lib/templates/campaign-templates";

/**
 * /flows/new?template=<slug>: creates a DRAFT flow (from a campaign
 * template when given) and opens it. Old /campaigns/new links land here.
 */
export default async function NewFlowPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const slug = Array.isArray(params.template) ? params.template[0] : params.template;
  const template = getCampaignTemplate(slug);
  return <NewFlowStarter templateSlug={template?.slug ?? null} templateTitle={template?.title ?? null} />;
}
