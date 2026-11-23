import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Corporate Sustainability Intelligence", template: "%s · Corporate Sustainability Intelligence" },
  description:
    "Benchmarks the sustainability disclosures of large operating companies. Every value traces to a source page.",
};

const NAV: [string, string][] = [
  ["/", "Dashboard"],
  ["/compare", "Compare"],
  ["/peers", "Peers"],
  ["/targets", "Targets"],
  ["/transparency", "Transparency"],
  ["/rankings", "Rankings"],
  ["/methodology", "Methodology"],
  ["/downloads", "Downloads"],
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="border-b border-hairline bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
            <Link href="/" className="text-sm font-semibold text-ink">
              Corporate Sustainability Intelligence
            </Link>
            <nav aria-label="Main" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href} className="hover:text-ink">
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
        <footer className="border-t border-hairline bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-ink-muted">
            Every number traces to a source document and page. Missing is not zero: values are marked Disclosed, Not
            disclosed, Not found or Not assessed. Values on different boundaries or methods are shown side by side, never
            combined.
          </div>
        </footer>
      </body>
    </html>
  );
}
