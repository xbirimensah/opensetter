import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignReportBySlug } from "@/lib/reports/data";

type ReportPageProps = {
  params: Promise<{ shareSlug: string }>;
};

function formatDate(date: Date | null) {
  if (!date) return "No sends yet";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function MetricCell({
  label,
  value,
  helper,
}: {
  label: string;
  value: string | number;
  helper: string;
}) {
  return (
    <div className="min-w-0 bg-surface px-5 py-5">
      <p className="text-footnote text-muted">{label}</p>
      <p className="mt-1 text-metric font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-2 text-caption leading-snug text-faint">{helper}</p>
    </div>
  );
}

export async function generateMetadata({
  params,
}: ReportPageProps): Promise<Metadata> {
  const { shareSlug } = await params;
  const report = await getCampaignReportBySlug(shareSlug);

  if (!report) {
    return {
      title: "Report Not Found",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: `${report.campaign.name} Campaign Report`,
    description: `Read-only Instagram comment-to-DM campaign report for ${report.campaign.name}.`,
    robots: { index: false, follow: false },
  };
}

export default async function ReportPage({ params }: ReportPageProps) {
  const { shareSlug } = await params;
  const report = await getCampaignReportBySlug(shareSlug);

  if (!report) {
    notFound();
  }

  const maxDaily = Math.max(
    ...report.daily.map((day) => Math.max(day.sent, day.clicks)),
    1
  );

  return (
    <main className="min-h-screen bg-background text-foreground" data-theme="dark">
      <header className="mx-auto w-full max-w-6xl px-5 pb-8 pt-12 sm:px-6 sm:pt-16 lg:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="text-footnote font-semibold text-accent">Client campaign report</p>
            <h1 className="mt-3 max-w-3xl text-[2.5rem] font-bold leading-[1.06] tracking-[-0.026em] text-foreground sm:text-5xl">
              {report.campaign.name}
            </h1>
            <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span>@{report.campaign.instagramUsername}</span>
              {report.campaign.goal && (
                <>
                  <span aria-hidden="true" className="text-quiet">·</span>
                  <span>{report.campaign.goal}</span>
                </>
              )}
              <span aria-hidden="true" className="text-quiet">·</span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    report.campaign.isActive ? "bg-success" : "bg-quiet"
                  }`}
                />
                {report.campaign.isActive ? "Active campaign" : "Paused campaign"}
              </span>
            </p>
          </div>

          <div className="panel p-4 md:min-w-64">
            <p className="text-caption text-faint">Workspace</p>
            <p className="mt-1 text-headline font-semibold text-foreground">
              {report.workspace.name}
            </p>
            <p className="mt-3 text-caption text-faint">
              Generated {formatDate(report.generatedAt)}
            </p>
            {report.branded && (
              <Link href="/" className="btn btn-secondary btn-sm mt-4">
                Powered by OpenSetter
              </Link>
            )}
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl space-y-6 px-5 pb-16 sm:px-6 lg:px-8">
        <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-border lg:grid-cols-5">
          <MetricCell
            label="DMs sent"
            value={report.metrics.sent}
            helper="Private replies successfully sent."
          />
          <MetricCell
            label="Skipped"
            value={report.metrics.skipped}
            helper="Duplicates, limits, or no-send outcomes."
          />
          <MetricCell
            label="Failed"
            value={report.metrics.failed}
            helper="Replies that need operational review."
          />
          <MetricCell
            label="Clicks"
            value={report.metrics.clicks}
            helper="Tracked link visits from replies."
          />
          <div className="col-span-2 bg-surface lg:col-span-1">
            <MetricCell
              label="CTR"
              value={`${report.metrics.ctr}%`}
              helper="Clicks divided by sent replies."
            />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <section aria-labelledby="report-week" className="panel p-5 sm:p-6">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <div>
                <h2 id="report-week" className="text-title-3 font-semibold text-foreground">
                  Last 7 days
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Sent replies and tracked clicks by day.
                </p>
              </div>
              <p className="text-caption text-faint">
                Last send: {formatDate(report.metrics.latestSentAt)}
              </p>
            </div>
            <ol className="mt-8 grid h-56 grid-cols-7 items-end gap-1.5 sm:gap-3">
              {report.daily.map((day) => (
                <li
                  key={day.date}
                  className="flex h-full flex-col justify-end gap-2"
                  aria-label={`${day.date}: ${day.sent} sent, ${day.clicks} clicks`}
                >
                  <div className="flex min-h-0 flex-1 items-end justify-center gap-1">
                    <div
                      className="w-full max-w-5 rounded-t-md rounded-b-sm bg-accent"
                      style={{
                        height: `${Math.max((day.sent / maxDaily) * 100, 3)}%`,
                      }}
                      title={`${day.sent} sent`}
                    />
                    <div
                      className="w-full max-w-5 rounded-t-md rounded-b-sm bg-muted/60"
                      style={{
                        height: `${Math.max((day.clicks / maxDaily) * 100, 3)}%`,
                      }}
                      title={`${day.clicks} clicks`}
                    />
                  </div>
                  <p className="whitespace-nowrap text-center text-[0.6875rem] text-faint sm:text-caption">
                    {day.date}
                  </p>
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap gap-4 text-footnote text-muted">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-accent" />
                Sent replies
              </span>
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-muted/60" />
                Link clicks
              </span>
            </div>
          </section>

          <aside className="space-y-6">
            <section aria-labelledby="report-keywords" className="panel p-5 sm:p-6">
              <h2 id="report-keywords" className="text-title-3 font-semibold text-foreground">
                Top keywords
              </h2>
              <div className="mt-4">
                {report.topKeywords.length === 0 && (
                  <p className="text-sm text-muted">No matched keyword data yet.</p>
                )}
                {report.topKeywords.map((keyword, index) => (
                  <div
                    key={keyword.keyword}
                    className={`flex items-center justify-between gap-4 py-2.5 ${
                      index > 0 ? "border-t border-border" : ""
                    }`}
                  >
                    <span className="text-sm font-medium text-foreground">{keyword.keyword}</span>
                    <span className="text-sm tabular-nums text-muted">{keyword.count}</span>
                  </div>
                ))}
              </div>
            </section>

            <section aria-labelledby="report-links" className="panel p-5 sm:p-6">
              <h2 id="report-links" className="text-title-3 font-semibold text-foreground">
                Tracked links
              </h2>
              <div className="mt-4">
                {report.trackedLinks.length === 0 && (
                  <p className="text-sm text-muted">
                    This campaign does not have a tracked link.
                  </p>
                )}
                {report.trackedLinks.map((link, index) => (
                  <div
                    key={link.slug}
                    className={`flex items-center justify-between gap-4 py-2.5 ${
                      index > 0 ? "border-t border-border" : ""
                    }`}
                  >
                    <span className="min-w-0 truncate text-sm text-muted">
                      {link.destinationHost}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {link.clicks}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <section aria-labelledby="report-setup" className="panel p-5 sm:p-6">
          <h2 id="report-setup" className="text-title-3 font-semibold text-foreground">
            Campaign setup
          </h2>
          <dl className="mt-5 grid gap-6 md:grid-cols-3">
            <div>
              <dt className="text-caption text-faint">Keywords</dt>
              <dd className="mt-2 flex flex-wrap gap-1.5">
                {report.campaign.keywords.map((keyword) => (
                  <span
                    key={keyword}
                    className="rounded-full bg-fill-strong px-2.5 py-1 text-footnote font-medium text-foreground"
                  >
                    {keyword}
                  </span>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-faint">Created</dt>
              <dd className="mt-2 text-sm text-foreground">
                {formatDate(report.campaign.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-faint">Source post</dt>
              <dd className="mt-2">
                {report.campaign.postUrl ? (
                  <a
                    href={report.campaign.postUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold text-accent hover:underline"
                  >
                    View Instagram post
                  </a>
                ) : (
                  <span className="text-sm text-muted">Not attached</span>
                )}
              </dd>
            </div>
          </dl>
        </section>

        {report.branded && (
          <footer className="pt-6 text-center text-caption text-faint">
            Built with OpenSetter, the Instagram comment-to-DM campaign OS.
          </footer>
        )}
      </section>
    </main>
  );
}
