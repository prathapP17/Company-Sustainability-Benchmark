import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { allScores, listCompanies, listPeerGroups } from "@/lib/db/queries";

export const metadata: Metadata = { title: "Peer groups" };

export default function PeersIndex() {
  const groups = listPeerGroups();
  const companies = listCompanies();
  const scores = new Map(allScores().map((s) => [s.company_id, s]));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Peer groups</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Companies are benchmarked against peers in the same industry. A peer median is shown only when at least three
          peers report a comparable value.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => {
          const members = companies.filter((c) => c.peer_group === g.id);
          return (
            <Card key={g.id} title={g.name} action={<Link href={`/peers/${g.id}`} className="text-sm text-accent hover:underline">Open benchmark →</Link>}>
              <p className="text-sm text-ink-2">{g.description}</p>
              <p className="mt-1 text-xs text-ink-muted">SASB: {(JSON.parse(g.sasb_industries) as string[]).join("; ")}</p>
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {members.map((c) => {
                  const s = scores.get(c.id);
                  return (
                    <li key={c.id} className="flex justify-between gap-2">
                      <Link href={`/companies/${c.id}`} className="text-accent hover:underline">
                        {c.name}
                      </Link>
                      <span className="tabular text-xs text-ink-muted">
                        Transparency {s?.transparency_score !== null && s?.transparency_score !== undefined ? Math.round(s.transparency_score) : "n/a"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {members.filter((c) => c.research_status !== "profile_only").length < 3 && (
                <p className="mt-3 text-xs text-ink-muted">
                  Fewer than three researched companies: values are shown side by side without a median.
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
