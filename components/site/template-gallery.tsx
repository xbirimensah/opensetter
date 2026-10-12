import Link from "next/link";
import { ChevronIcon } from "@/components/public-site-icons";
import { CAMPAIGN_TEMPLATES } from "@/lib/templates/campaign-templates";

/* Every campaign template as a card: what people comment, and what they
   get back. Each card opens sign-in with the template preselected (the
   login page reads ?template=<slug>). */
export default function TemplateGallery() {
  return (
    <ul className="site-swipe sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-4">
      {CAMPAIGN_TEMPLATES.map((template) => (
        <li key={template.slug} className="w-[16rem] sm:w-auto">
          <Link
            href={`/login?template=${template.slug}`}
            className="site-card site-card-link flex h-full flex-col p-4"
          >
            <p className="site-label">{template.category}</p>
            <h3 className="mt-1.5 text-[0.9375rem] font-semibold leading-5 tracking-[-0.006em]">
              {template.title}
            </h3>
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Keywords">
              {template.keywords.map((keyword) => (
                <li key={keyword} className="site-chip site-chip-accent">
                  {keyword}
                </li>
              ))}
            </ul>
            <p className="mt-3 line-clamp-3 text-[0.8125rem] leading-5 text-muted">
              {template.privateReplyPreview}
            </p>
            <span className="site-link mt-auto pt-4 text-[0.8125rem]">
              Use this template
              <ChevronIcon className="h-3 w-3" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
