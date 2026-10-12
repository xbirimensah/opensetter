import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenSetter - Open source Instagram comment-to-DM automation with an AI setter",
  description:
    "ManyChat and an AI setter in one: open source, self-hosted Instagram comment-to-DM automation plus an AI that answers your DMs in your voice, qualifies prospects, and books calls, using the official Meta API.",
  keywords: [
    "instagram automation",
    "comment to DM",
    "instagram private replies",
    "ai dm setter",
    "instagram ai setter",
    "social commerce",
    "instagram dm automation",
  ],
};

// viewport-fit=cover lets the app shell pad itself with the iOS safe-area
// insets (notch, home indicator) instead of the browser letterboxing it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#050505" },
    { media: "(prefers-color-scheme: light)", color: "#F5F5F5" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the inline script below stamps data-theme
    // on <html> before paint, which React must not treat as a mismatch.
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script
          // Apply the stored theme before first paint so a light-mode
          // user never sees a dark flash (and vice versa).
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("theme");if(t==="light")document.documentElement.dataset.theme="light"}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
