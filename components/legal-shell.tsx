import PublicSiteFooter from "@/components/public-site-footer";
import PublicSiteHeader from "@/components/public-site-header";

interface LegalShellProps {
  title: string;
  description: string;
  updatedAt: string;
  children: React.ReactNode;
}

export default function LegalShell({
  title,
  description,
  updatedAt,
  children,
}: LegalShellProps) {
  return (
    <main className="min-h-screen bg-background text-foreground" data-theme="site">
      <PublicSiteHeader />

      <article className="site-container max-w-[calc(46rem+2*var(--site-gutter))] pb-20 pt-14 sm:pb-28 sm:pt-20">
        <p className="site-label">Last updated {updatedAt}</p>
        <h1 className="site-headline mt-4">{title}</h1>
        <p className="site-lead mt-6">{description}</p>
        <div className="site-prose mt-12 border-t border-border pt-10">{children}</div>
      </article>

      <PublicSiteFooter />
    </main>
  );
}
