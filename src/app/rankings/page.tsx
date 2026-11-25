import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { ScoreBar } from "@/components/ScoreBar";
import { allIndicators, allScores, listCompanies } from "@/lib/db/queries";
import { industryName } from "@/lib/industry";
import { INDICATOR_LABELS, MIN_INDICATORS } from "@/lib/scoring/performance";

export const metadata: Metadata = { title: "Rankings" };

export default function RankingsPage() {
  const companies = listCompanies();
  const name = new Map(companies.map((c) => [c.id, c]));
  const scores = allScores();
  const indicators = allIndicators();

  const transparencyRanked = scores.filter((s) => s.transparency_score !== null).sort((a, b) => b.transparency_score! - a.transparency_score!);
  const transparencyUnscored = scores.filter((s) => s.transparency_score === null);
  const performanceRanked = scores.filter((s) => s.performance_score !== null).sort((a, b) => b.performance_score! - a.performance_score!);
  const performanceUnscored = scores.filter((s) => s.performance_score === null);
  // Peer rank only within one confirmed SASB industry (never the broad navigation group).
  const peerRank = (id: string, key: "transparency_score" | "performance_score") => {
    const c = name.get(id)!;
    if (!c.primary_sasb) return "no industry rank: classification needs review";
    const peers = scores.filter((s) => name.get(s.company_id)?.primary_sasb === c.primary_sasb && s[key] !== null).sort((a, b) => b[key]! - a[key]!);
    if (peers.length < 2) return null;
    return `${peers.findIndex((p) => p.company_id === id) + 1} of ${peers.length} in ${industryName(c.primary_sasb)}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Rankings</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Two separate rankings. Transparency rewards complete, well-evidenced disclosure. Performance uses only
          comparable values (consolidated group, full coverage, no method change) and needs at least {MIN_INDICATORS} of
          5 indicators, so many companies are not scored yet. See the{" "}
          <Link href="/methodology" className="text-accent hover:underline">
            methodology
          </Link>
          .
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Transparency ranking">
          <ol className="flex flex-col gap-3">
            {transparencyRanked.map((s, i) => (
              <li key={s.company_id}>
                <div className="flex justify-between gap-2 text-sm">
                  <span>
                    <span className="tabular text-ink-muted">{i + 1}. </span>
                    <Link href={`/companies/${s.company_id}`} className="text-accent hover:underline">
                      {name.get(s.company_id)?.name}
                    </Link>
                  </span>
                  <span className="text-xs text-ink-muted">{peerRank(s.company_id, "transparency_score")}</span>
                </div>
                <ScoreBar value={s.transparency_score} label={`${name.get(s.company_id)?.name} transparency`} />
              </li>
            ))}
          </ol>
          {transparencyUnscored.length > 0 && (
            <div className="mt-4 border-t border-hairline pt-3 text-xs text-ink-muted">
              Not scored:{" "}
              {transparencyUnscored.map((s) => `${name.get(s.company_id)?.name} (${s.transparency_reason})`).join("; ")}
            </div>
          )}
        </Card>

        <Card title="Performance ranking">
          {performanceRanked.length === 0 ? (
            <p className="text-sm text-ink-muted">No company has enough comparable data yet.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {performanceRanked.map((s, i) => (
                <li key={s.company_id}>
                  <div className="flex justify-between gap-2 text-sm">
                    <span>
                      <span className="tabular text-ink-muted">{i + 1}. </span>
                      <Link href={`/companies/${s.company_id}`} className="text-accent hover:underline">
                        {name.get(s.company_id)?.name}
                      </Link>
                    </span>
                    <span className="text-xs text-ink-muted">{s.performance_available} of 5 indicators</span>
                  </div>
                  <ScoreBar value={s.performance_score} label={`${name.get(s.company_id)?.name} performance`} />
                </li>
              ))}
            </ol>
          )}
          <div className="mt-4 border-t border-hairline pt-3 text-xs text-ink-muted">
            Not scored ({performanceUnscored.length}):{" "}
            {performanceUnscored.map((s) => name.get(s.company_id)?.name).join(", ")}. Reasons per indicator below.
          </div>
        </Card>
      </div>

      <Card title="Performance indicators">
        <p className="mb-3 text-xs text-ink-muted">
          Indicator scores 0-100. Raw values in brackets. A dash means the indicator could not be computed; hover for the
          reason.
        </p>
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 200 + 5 * 130 }}>
            <thead>
              <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                <th className="py-2 pr-3 font-medium">Company</th>
                {Object.values(INDICATOR_LABELS).map((l) => (
                  <th key={l} className="py-2 pr-3 font-medium">
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="border-b border-hairline align-top last:border-0">
                  <td className="py-2 pr-3">
                    <Link href={`/companies/${c.id}`} className="text-accent hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  {Object.keys(INDICATOR_LABELS).map((k) => {
                    const ind = indicators.find((x) => x.company_id === c.id && x.indicator_id === k);
                    return (
                      <td key={k} className="tabular py-2 pr-3" title={ind?.detail ?? ""}>
                        {ind?.score !== null && ind?.score !== undefined ? (
                          <>
                            <span className="text-ink">{Math.round(ind.score)}</span>{" "}
                            <span className="text-xs text-ink-muted">
                              ({ind.raw_value}
                              {ind.raw_unit === "%" || ind.raw_unit === "% change" ? "%" : ""})
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-ink-muted">– {ind?.detail}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
