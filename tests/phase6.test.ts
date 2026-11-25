import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ambitionOf, percentOf } from "@/lib/scoring/ambition";
import { loadSbti, sbtiFor } from "@/lib/sbti/load";
import { buildFacts, type Fact } from "@/lib/summaries/facts";
import { checkSummary } from "@/lib/summaries/check";
import { summarizeCompany } from "@/lib/summaries/run";
import { readSummary, summaryState } from "@/lib/summaries/store";
import { buildQuery, fetchNews, listNews, NewsError, parseGdelt, reviewNews, topicsIn } from "@/lib/news/gdelt";
import { loadCompanies } from "@/lib/data/load";
import { closePipelineDbs, pipelineDb } from "@/lib/pipeline/db";
import { REAL_DATA, tempDataDir } from "./helpers";

let dir: string;
let cleanup: () => void;
beforeEach(() => {
  const t = tempDataDir();
  dir = t.dir;
  cleanup = t.cleanup;
  cpSync(path.join(REAL_DATA, "sbti.json"), path.join(dir, "sbti.json"));
  cpSync(path.join(REAL_DATA, "news.json"), path.join(dir, "news.json"));
});
afterEach(() => {
  closePipelineDbs();
  cleanup();
});

describe("target ambition (pace) check", () => {
  const base = { category: "emissions", type: "absolute", unit: "% reduction" };
  it("compares the implied linear yearly reduction with SBTi's 4.2% and 2.5% minimums", () => {
    // Apple: 62% by 2030 from 2019 = 5.64%/yr.
    expect(ambitionOf({ ...base, baselineYear: 2019, targetYear: 2030, reductionPct: 62 })).toEqual({ status: "pace_1_5", ratePerYear: 5.64 });
    // Siemens Scope 3: 30% by 2030 from 2019 = 2.73%/yr.
    expect(ambitionOf({ ...base, baselineYear: 2019, targetYear: 2030, reductionPct: 30 }).status).toBe("pace_wb2c");
    expect(ambitionOf({ ...base, baselineYear: 2020, targetYear: 2030, reductionPct: 20 })).toEqual({ status: "below_wb2c", ratePerYear: 2 });
  });
  it("does not assess intensity, net-zero or incomplete targets", () => {
    expect(ambitionOf({ ...base, type: "intensity", baselineYear: 2019, targetYear: 2030, reductionPct: 50 }).status).toBe("not_assessable");
    expect(ambitionOf({ ...base, type: "net_zero", baselineYear: null, targetYear: 2050, reductionPct: null }).status).toBe("not_assessable");
    expect(ambitionOf({ ...base, baselineYear: null, targetYear: 2030, reductionPct: 50 }).reason).toMatch(/base year/);
    expect(ambitionOf({ ...base, category: "water", baselineYear: 2019, targetYear: 2030, reductionPct: 50 }).status).toBe("not_assessable");
    expect(percentOf("50.4%")).toBe(50.4);
    expect(percentOf("NA")).toBeNull();
  });
});

describe("SBTi extract", () => {
  it("is cited, pinned per company, and records companies not in the dashboard", () => {
    const sbti = loadSbti(dir)!;
    expect(sbti.source.files.every((f) => f.sha256.length === 64)).toBe(true);
    expect(sbtiFor(sbti, "apple")).toMatchObject({ kind: "found", company: { name: "Apple, Inc.", sbtiId: "40003329" } });
    expect(sbtiFor(sbti, "samsung").kind).toBe("not_found");
    expect(sbtiFor(sbti, "unknown").kind).toBe("not_checked");
  });
});

// ---------------------------------------------------------------- AI summaries

const facts: Fact[] = [
  { id: "F1", kind: "value", text: "Scope 1 GHG emissions, FY2025 (to Sep 2025): 55,200 tCO2e (consolidated group)", sourceId: "s", page: "p.9", url: null },
  { id: "F2", kind: "gap", text: "Water withdrawal: not found (FY2025 (to Sep 2025))", sourceId: "s", page: null, url: null },
  { id: "F3", kind: "change", text: "Scope 1 GHG emissions: 55,200 tCO2e in FY2025 versus 60,000 tCO2e in FY2024, a change of -8% (derived)", sourceId: "s", page: null, url: null },
];

describe("AI summary check", () => {
  it("passes sentences whose numbers all appear in the facts they cite", () => {
    const r = checkSummary(
      [
        { text: "The company reported 55,200 tCO2e of Scope 1 emissions in FY2025.", citations: ["F1"] },
        { text: "That is a decrease of 8% from 60,000 tCO2e in FY2024, calculated from reported figures; water withdrawal was not found.", citations: ["F3", "F2"] },
      ],
      facts,
    );
    expect(r).toEqual({ ok: true, problems: [] });
  });
  it("rejects invented or uncited numbers, unknown citations, comparisons and spelled-out quantities", () => {
    const r = checkSummary(
      [
        { text: "Scope 1 emissions were 55,000 tCO2e in FY2025.", citations: ["F1"] },
        { text: "Emissions fell 8% in FY2024.", citations: [] },
        { text: "It is a leading company that halved emissions.", citations: ["F9"] },
        { text: "Emissions dropped by one tenth.", citations: ["F3"] },
      ],
      facts,
    );
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(/"55000" is not in the facts/);
    expect(r.problems.join("\n")).toMatch(/sentence 2 cites nothing/);
    expect(r.problems.join("\n")).toMatch(/unknown fact F9/);
    expect(r.problems.join("\n")).toMatch(/leading.*comparison/);
    expect(r.problems.join("\n")).toMatch(/"one" \(spelled-out quantity\)/);
  });
});

const fakeClient = (sentences: { text: string; citations: string[] }[]) =>
  ({
    beta: {
      messages: {
        parse: async () => ({ stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 120 }, parsed_output: { sentences } }),
      },
    },
  }) as never;

describe("AI summaries end to end (fake Claude)", () => {
  it("builds facts from the curated file with sources and derived year-on-year changes", () => {
    const apple = loadCompanies(dir).companies.find((c) => c.profile.id === "apple")!;
    const f = buildFacts(apple, sbtiFor(loadSbti(dir), "apple"));
    const scope1 = f.find((x) => x.kind === "value" && x.text.startsWith("Scope 1 GHG emissions"))!;
    expect(scope1.text).toMatch(/55,200 tCO2e/);
    expect(scope1.sourceId).toBeTruthy();
    expect(f.some((x) => x.kind === "sbti" && /near-term Validated Targets/.test(x.text))).toBe(true);
    expect(f.filter((x) => x.kind === "change").every((x) => x.text.endsWith("(derived)"))).toBe(true);
  });

  it("publishes only summaries that pass the check, and hides them once the data changes", async () => {
    const db = pipelineDb(dir);
    const apple = loadCompanies(dir).companies.find((c) => c.profile.id === "apple")!;
    const f = buildFacts(apple, sbtiFor(loadSbti(dir), "apple"));
    const s1 = f.find((x) => x.text.startsWith("Scope 1 GHG emissions"))!;
    const sb = f.find((x) => x.kind === "sbti")!;

    const bad = await summarizeCompany(db, "apple", "Test Reviewer", { dataDir: dir, client: fakeClient([{ text: "Apple emitted 99,999 tCO2e.", citations: [s1.id] }, { text: "It is the best performer.", citations: [sb.id] }]) });
    expect(bad.ok).toBe(false);
    expect(readSummary("apple", dir)).toBeNull();

    const good = await summarizeCompany(db, "apple", "Test Reviewer", {
      dataDir: dir,
      client: fakeClient([
        { text: "Apple reported Scope 1 GHG emissions of 55,200 tCO2e in FY2025.", citations: [s1.id] },
        { text: "The SBTi Target Dashboard lists its near-term target as validated.", citations: [sb.id] },
      ]),
    });
    expect(good.ok).toBe(true);
    expect(summaryState("apple", dir).kind).toBe("current");
    const audits = db.prepare("SELECT action FROM audit_log WHERE action LIKE 'summary_%' ORDER BY id").all();
    expect(audits).toEqual([{ action: "summary_rejected_by_check" }, { action: "summary_published" }]);

    // Change the curated data: the published summary no longer matches its facts.
    const file = path.join(dir, "companies", "apple.json");
    const json = JSON.parse(readFileSync(file, "utf8"));
    json.metrics.find((m: { metric: string; year: number }) => m.metric === "ghg_scope1" && m.year === 2025).value = 55300;
    writeFileSync(file, JSON.stringify(json));
    expect(summaryState("apple", dir).kind).toBe("outdated");
  });
});

// ---------------------------------------------------------------- news

describe("GDELT news signals", () => {
  it("builds the query, parses articles and treats GDELT's plain-text notices as errors", () => {
    expect(buildQuery(['"Apple Inc"'], ["emissions", '"human rights"'], "english")).toBe('"Apple Inc" (emissions OR "human rights") sourcelang:english');
    expect(buildQuery(["Sony", '"Sony Group"'], ["spill"], "english")).toBe('(Sony OR "Sony Group") (spill) sourcelang:english');
    const a = parseGdelt(JSON.stringify({ articles: [{ url: "https://news.example/a", title: "Plant  spill  probed", seendate: "20261120T081500Z", domain: "news.example", sourcecountry: "Germany" }, { url: "javascript:x", title: "bad" }] }));
    expect(a).toEqual([{ url: "https://news.example/a", title: "Plant spill probed", domain: "news.example", language: null, sourceCountry: "Germany", seenAt: "2026-11-20T08:15:00Z" }]);
    expect(parseGdelt("{}")).toEqual([]);
    expect(() => parseGdelt("Please limit requests to one every 5 seconds")).toThrow(/GDELT: Please limit/);
    expect(topicsIn("Toxic spill: human rights groups protest", ["spill", '"human rights"', "lawsuit"])).toEqual(["spill", "human rights"]);
  });

  it("stores new items as pending, spaces requests to GDELT, dedupes, and needs a note to approve", async () => {
    const db = pipelineDb(dir);
    const waits: number[] = [];
    const calls: string[] = [];
    const fetchImpl = async (u: string) => {
      calls.push(u);
      if (u.endsWith("/robots.txt")) return new Response("", { status: 404 });
      const q = new URL(u).searchParams.get("query") ?? "";
      if (q.includes("Siemens")) return new Response("Please limit requests to one every 5 seconds", { status: 200 });
      return new Response(JSON.stringify({ articles: [{ url: `https://news.example/${encodeURIComponent(q.slice(0, 12))}`, title: "Factory fined over pollution", seendate: "20261120T081500Z", domain: "news.example" }] }), { status: 200 });
    };
    const run = () => fetchNews(db, dir, { companies: ["apple", "siemens"], fetchImpl, sleep: async (ms) => void waits.push(ms) });
    const first = await run();
    expect(first).toMatchObject({ found: 1, added: 1 });
    expect(first.errors.join()).toMatch(/siemens: GDELT rate limit/);
    expect(calls.filter((u) => u.includes("Siemens")).length).toBe(2); // retried once
    expect(waits.every((w) => w >= 5000)).toBe(true); // never faster than GDELT allows
    expect((await run()).added).toBe(0); // same URL is not added twice

    const [item] = listNews(db, "pending", "apple");
    expect(JSON.parse(item.topics!)).toEqual(["pollution", "fined"]);
    expect(() => reviewNews(db, item.id, "Rev", "approve", "short")).toThrow(NewsError);
    reviewNews(db, item.id, "Rev", "approve", "Regulator fine at a supplier plant; relevant to pollution controls.");
    expect(listNews(db, "approved", "apple")).toHaveLength(1);
    reviewNews(db, item.id, "Rev", "reject"); // withdraw
    expect(listNews(db, "approved", "apple")).toHaveLength(0);
    const actions = (db.prepare("SELECT action FROM audit_log WHERE action LIKE 'news_%' ORDER BY id").all() as { action: string }[]).map((r) => r.action);
    expect(actions).toEqual(["news_fetch", "news_fetch", "news_approved", "news_withdrawn"]);
  });
});
