import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import PublicSiteFooter from "@/components/public-site-footer";
import PublicSiteHeader from "@/components/public-site-header";
import { CheckIcon, GitHubMark } from "@/components/public-site-icons";
import { GITHUB_URL, siteViewport } from "@/components/public-site-links";
import AgencyMock from "@/components/site/agency-mock";
import AiSetterMock from "@/components/site/ai-setter-mock";
import { ChipList, FlowCanvas, STEP_TYPES, TRIGGERS } from "@/components/site/flow-canvas";
import FlowStory from "@/components/site/flow-story";
import InboxMock from "@/components/site/inbox-mock";
import TemplateGallery from "@/components/site/template-gallery";
import WeekChart from "@/components/site/week-chart";

export const metadata: Metadata = {
  title: "OpenSetter - ManyChat and an AI setter in one",
  description:
    "ManyChat-style comment-to-DM flows and an AI setter that answers in your voice, in one open source app you host yourself. Built on the official Instagram API.",
};

export const viewport: Viewport = siteViewport;

/* Facts that hold for every install, each one backed by the code or the
   legal pages: no performance claims. */
const facts = [
  {
    title: "Official Instagram API",
    body: "No scraping, no passwords, no browser automation.",
  },
  {
    title: "Encrypted tokens",
    body: "Instagram access tokens are encrypted at rest.",
  },
  {
    title: "Nothing slips through",
    body: "Webhooks catch comments live. A polling sweep catches the rest.",
  },
  {
    title: "One reply per comment",
    body: "Deduplicated, so nobody gets the same private reply twice.",
  },
  {
    title: "Queued and rate-limited",
    body: "Every send waits its turn per account and is logged.",
  },
  {
    title: "Yours to run",
    body: "Self-hosted, MIT licensed, no plan limits.",
  },
];

function SectionHead({
  eyebrow,
  title,
  caption,
  className = "",
}: {
  eyebrow: string;
  title: string;
  caption: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="site-eyebrow">{eyebrow}</p>
      <h2 className="site-title mt-3">{title}</h2>
      <p className="site-body mt-4 max-w-md text-base">{caption}</p>
    </div>
  );
}

async function getGitHubStars(): Promise<number | null> {
  try {
    const res = await fetch("https://api.github.com/repos/xbirimensah/opensetter", {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { stargazers_count?: number };
    return typeof data.stargazers_count === "number" ? data.stargazers_count : null;
  } catch {
    return null;
  }
}

export default async function Home() {
  const stars = await getGitHubStars();
  return (
    <main className="min-h-screen bg-background text-foreground" data-theme="site">
      <PublicSiteHeader stars={stars} />

      <section className="site-container pt-14 text-center sm:pt-24">
        <p className="site-eyebrow">Open source · Self-hosted · Official Instagram API</p>
        <h1 className="site-display mx-auto mt-4 max-w-4xl">
          ManyChat and an AI setter in one.
        </h1>
        <p className="site-lead mx-auto mt-5 max-w-xl">
          Comment-to-DM flows, plus an AI that answers in your voice when people
          reply.
        </p>
        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/login" className="site-btn site-btn-primary site-btn-lg">
            Get started
          </Link>
          <a href={GITHUB_URL} className="site-btn site-btn-secondary site-btn-lg">
            <GitHubMark />
            View on GitHub
          </a>
        </div>
      </section>

      <section id="how" className="site-container pb-24 pt-14 sm:pb-32 sm:pt-20">
        <h2 className="sr-only">How it works</h2>
        <FlowStory />
      </section>

      <section id="flows" className="site-container pb-24 sm:pb-32">
        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          <div className="space-y-10 lg:order-last">
            <SectionHead
              eyebrow="Flows"
              title="Build it once, as steps."
              caption="Pick a trigger, chain the steps, hand off to the AI setter."
            />
            <ChipList label="step types" items={STEP_TYPES} />
            <ChipList label="triggers" items={TRIGGERS} />
          </div>
          <FlowCanvas />
        </div>
      </section>

      <section id="inbox" className="site-container pb-24 sm:pb-32">
        <div className="grid items-center gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:gap-16">
          <SectionHead
            eyebrow="Inbox"
            title="Every DM in one inbox."
            caption="Voice notes, cards, photos and files, the way Instagram sends them."
          />
          <InboxMock />
        </div>
      </section>

      <section id="ai-setter" className="site-container pb-24 sm:pb-32">
        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          <SectionHead
            className="lg:order-last"
            eyebrow="AI setter"
            title="It answers in your voice, and knows when to wait."
            caption="On Auto, replies that pass every check go out. Anything that commits you, like a price or a meeting, waits for your review."
          />
          <AiSetterMock />
        </div>
      </section>

      <section id="results" className="site-container pb-24 sm:pb-32">
        <div className="grid items-center gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:gap-16">
          <SectionHead
            eyebrow="Results"
            title="See what every comment turned into."
            caption="Sends, skips, failures and link clicks, logged per campaign."
          />
          <WeekChart />
        </div>
      </section>

      <section id="templates" className="site-container pb-24 sm:pb-32">
        <SectionHead
          eyebrow="Templates"
          title="Start from a template."
          caption="Pick one and it is ready for you right after sign-in."
        />
        <div className="mt-10">
          <TemplateGallery />
        </div>
      </section>

      <section id="agencies" className="site-container pb-24 sm:pb-32">
        <div className="grid items-center gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:gap-16">
          <SectionHead
            eyebrow="Agencies"
            title="Run it for clients."
            caption="Multiple Instagram accounts, team roles, and report links clients open without logging in."
          />
          <AgencyMock />
        </div>
      </section>

      <section id="security" className="site-container pb-24 sm:pb-32">
        <SectionHead
          eyebrow="Security"
          title="Built on the official Instagram API."
          caption="What every install does, out of the box."
        />
        <ul className="mt-10 grid gap-x-8 border-t border-border sm:grid-cols-2 lg:grid-cols-3">
          {facts.map((fact) => (
            <li key={fact.title} className="flex gap-3 border-b border-border py-5">
              <CheckIcon className="site-accent-text mt-0.5 h-5 w-5" />
              <div>
                <h3 className="site-subheading">{fact.title}</h3>
                <p className="site-body mt-1">{fact.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="site-container pb-24 sm:pb-32">
        <div className="site-card px-6 py-14 text-center sm:px-12 sm:py-20">
          <h2 className="site-title mx-auto max-w-2xl">
            Turn your next reel&rsquo;s comments into conversations.
          </h2>
          <p className="site-lead mx-auto mt-4 max-w-xl">
            Free and open source. Star it if it saves you a subscription.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/login" className="site-btn site-btn-primary site-btn-lg">
              Get started
            </Link>
            <a href={GITHUB_URL} className="site-btn site-btn-secondary site-btn-lg">
              <GitHubMark />
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      <PublicSiteFooter />
    </main>
  );
}
