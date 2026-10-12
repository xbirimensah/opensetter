import { githubIconPath } from "@/components/public-site-links";

/* Small inline icons for the public pages. All decorative: the text next
   to them carries the meaning, so they are hidden from assistive tech. */

interface IconProps {
  className?: string;
}

export function GitHubMark({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={`${className} shrink-0 fill-current`}>
      <path d={githubIconPath} />
    </svg>
  );
}

export function CheckIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`${className} shrink-0`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 10.5l3.2 3.2L15 6.8" />
    </svg>
  );
}

export function ChevronIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`${className} shrink-0`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3.5L10.5 8 6 12.5" />
    </svg>
  );
}
