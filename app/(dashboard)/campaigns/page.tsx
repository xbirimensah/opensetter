import { redirect } from "next/navigation";

/**
 * Campaigns merged into Flows: a comment campaign is now a flow's
 * "Comment on a post or reel" trigger, and classic campaigns are listed on
 * the Flows page with a Classic badge.
 */
export default function CampaignsRedirectPage() {
  redirect("/flows");
}
