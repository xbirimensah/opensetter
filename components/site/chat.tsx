import type { ReactNode } from "react";

/* Building blocks for the static product illustrations on the public
   page. Contact messages sit left in gray, the account's messages right
   in brand purple, the way Instagram lays out a business inbox. */

export function Screen({
  title,
  aside,
  className = "",
  children,
}: {
  title: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`site-screen ${className}`}>
      <div className="site-screen-bar">
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function Avatar({ initial }: { initial: string }) {
  return (
    <span className="site-avatar" aria-hidden="true">
      {initial}
    </span>
  );
}

export function InBubble({ children }: { children: ReactNode }) {
  return <p className="site-bubble site-bubble-in">{children}</p>;
}

export function OutBubble({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`site-bubble site-bubble-out ${className}`}>{children}</div>;
}

export function DmButton({ children }: { children: ReactNode }) {
  return <span className="site-dm-button">{children}</span>;
}

export function Meta({ children, align = "start" }: { children: ReactNode; align?: "start" | "end" }) {
  return (
    <p className={`site-bubble-meta ${align === "end" ? "self-end" : "self-start"}`}>{children}</p>
  );
}
