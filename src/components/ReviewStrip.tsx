"use client";

/**
 * Pending review work, shown on the public dashboard only to signed-in
 * reviewers and admins (the counts come from a reviewer-only endpoint; guests
 * and viewers see nothing here).
 */
import { useEffect, useState } from "react";
import Link from "next/link";

interface Overview {
  pending: number;
  blocked: number;
  possibleRestatements: number;
  openAlerts: number;
  awaitingFetch: number;
  newsPending: number;
  discovered30d: number;
}

export function ReviewStrip() {
  const [o, setO] = useState<Overview | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/pipeline/overview", { credentials: "same-origin", cache: "no-store" })
      .then(async (r) => (r.status === 200 ? ((await r.json()) as Overview) : (await r.arrayBuffer(), null)))
      .then((j) => {
        if (live) setO(j);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!o) return null;
  const items: [string, number, string][] = [
    ["Proposals to review", o.pending, "/review"],
    ["Blocked by the evidence check", o.blocked, "/review"],
    ["Possible restatements", o.possibleRestatements, "/review"],
    ["Open alerts", o.openAlerts, "/review/alerts"],
    ["Reports to fetch", o.awaitingFetch, "/review/discovered"],
    ["News items to review", o.newsPending, "/review/news"],
    ["Reports discovered (30 days)", o.discovered30d, "/review/discovered"],
  ];
  return (
    <section aria-label="Pending review (visible to reviewers)" className="rounded-lg border border-dashed border-[var(--axis)] p-3">
      <p className="mb-2 text-xs text-ink-muted">Pending review · only you and other reviewers see this</p>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {items.map(([label, n, href]) => (
          <li key={label}>
            <Link href={href} className="text-accent">
              <span className="tabular font-semibold">{n}</span> {label.toLowerCase()}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
