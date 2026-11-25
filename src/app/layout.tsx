import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";
import { SiteHeader, SiteHeaderView, type SearchItem } from "@/components/SiteHeader";
import { listCompanies } from "@/lib/db/queries";

export const metadata: Metadata = {
  title: { default: "Corporate Sustainability Intelligence", template: "%s · Corporate Sustainability Intelligence" },
  description:
    "Benchmarks the sustainability disclosures of large operating companies. Every value traces to a source page.",
};

/** Applies a saved theme choice before first paint (no flash of the wrong theme). */
const THEME_SCRIPT = `try{var t=localStorage.getItem("csi-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  const search: SearchItem[] = listCompanies().map((c) => ({
    id: c.id,
    name: c.name,
    hint: `${(JSON.parse(c.listings) as { ticker: string }[]).map((l) => l.ticker).join(", ")} · ${c.city}, ${c.country}`,
  }));
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-sm">
          Skip to content
        </a>
        <Suspense fallback={<SiteHeaderView search={search} path="" />}>
          <SiteHeader search={search} />
        </Suspense>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          {children}
        </main>
        <footer className="border-t border-hairline bg-surface">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-4 text-xs text-ink-muted sm:flex-row sm:justify-between">
            <p className="max-w-3xl">
              Every number traces to a source document and page. Missing is not zero: values are marked Disclosed, Not
              disclosed, Not found or Not assessed. Values on different boundaries, methods or periods are shown side by
              side, never combined.
            </p>
            <p className="flex shrink-0 gap-3">
              <Link href="/methodology" className="hover:underline">
                Methodology
              </Link>
              <Link href="/review" className="hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
