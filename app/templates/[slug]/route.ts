import { permanentTo } from "@/app/_site/redirect";
import { getCampaignTemplate } from "@/lib/templates/campaign-templates";

/* Template detail pages are retired; sign-in reads ?template=<slug> and
   carries it into the campaign draft. Unknown slugs land on the gallery. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const template = getCampaignTemplate(slug);
  if (!template) {
    return new Response(null, { status: 307, headers: { Location: "/#templates" } });
  }
  return permanentTo(`/login?template=${encodeURIComponent(template.slug)}`);
}
