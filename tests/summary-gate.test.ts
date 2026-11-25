import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync } from "node:fs";
import path from "node:path";
import { checkSummary, type Sentence } from "@/lib/summaries/check";
import type { Fact } from "@/lib/summaries/facts";
import { summarizeCompany } from "@/lib/summaries/run";
import { listCandidates, reviewCandidate, SummaryReviewError } from "@/lib/summaries/candidates";
import { readSummary } from "@/lib/summaries/store";
import { buildFacts } from "@/lib/summaries/facts";
import { loadCompanies } from "@/lib/data/load";
import { loadSbti, sbtiFor } from "@/lib/sbti/load";
import { closePipelineDbs, pipelineDb } from "@/lib/pipeline/db";
import { REAL_DATA, tempDataDir } from "./helpers";

const F: Fact[] = [
  { id: "F1", kind: "value", text: "Scope 1 GHG emissions, FY2025 (to Sep 2025): 55,200 tCO2e (consolidated group)", sourceId: "s", page: "p.9", url: null },
  { id: "F2", kind: "change", text: "Scope 1 GHG emissions: 55,200 tCO2e in FY2025 versus 60,000 tCO2e in FY2024, a change of -8% (derived)", sourceId: "s", page: null, url: null },
  { id: "F3", kind: "gap", text: "Water withdrawal: not found (FY2025 (to Sep 2025))", sourceId: "s", page: null, url: null },
  { id: "F4", kind: "value", text: "Renewable electricity share, FY2026 (to Mar 2026): 40 % (parent only)", sourceId: "s", page: "p.3", url: null },
  { id: "F5", kind: "target", text: "Target: Reduce absolute Scope 1 and 2 emissions 62% by 2030; target year 2030; base year 2019; company states SBTi validation", sourceId: "s", page: "p.2", url: null },
  { id: "F6", kind: "value", text: "Scope 3 GHG emissions (total), FY2025 (to Sep 2025): 14,500,000 tCO2e (consolidated group)", sourceId: "s", page: "p.10", url: null },
  { id: "F7", kind: "value", text: "Waste generated, 2025: 12,000 t (consolidated group; coverage: Factories only)", sourceId: "s", page: "p.12", url: null },
];
const ok: Sentence = { text: "Scope 1 GHG emissions were 55,200 tCO2e in FY2025.", citations: ["F1"] };
const run = (...s: Sentence[]) => checkSummary([ok, ...s], F);
const one = (text: string, citations: string[]) => run({ text, citations });

describe("AI summary evidence gate: adversarial sentences", () => {
  it("accepts well-supported sentences", () => {
    const r = run(
      { text: "Calculated from reported figures, Scope 1 emissions fell 8% from 60,000 tCO2e in FY2024.", citations: ["F2"] },
      { text: "Water withdrawal was not found in the sources reviewed.", citations: ["F3"] },
      { text: "Renewable electricity was 40 % of the parent company's electricity in FY2026.", citations: ["F4"] },
      { text: "The company states an SBTi-validated target to reduce absolute Scope 1 and 2 emissions 62% by 2030 from a 2019 base year.", citations: ["F5"] },
    );
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  const cases: [string, string, string[], RegExp][] = [
    ["single-year value as a trend", "Scope 1 emissions decreased to 55,200 tCO2e in FY2025.", ["F1"], /one year's value is not a trend/],
    ["wrong trend direction", "Calculated from reported figures, Scope 1 emissions rose 8% from FY2024.", ["F2"], /contradicts the direction/],
    ["interpretation of a change", "Calculated from reported figures, Scope 1 emissions improved by 8% versus FY2024.", ["F2"], /interprets a change/],
    ["unsupported causation", "Scope 1 emissions were 55,200 tCO2e in FY2025 due to energy efficiency projects.", ["F1"], /states a cause/],
    ["implied comparison", "At 55,200 tCO2e in FY2025, Scope 1 emissions are lower than the industry average.", ["F1"], /comparison or ranking/],
    ["target status claim", "The company is on track to meet its 62% reduction target by 2030.", ["F5"], /judges target status/],
    ["1.5°C claim not in facts", "The 62% by 2030 target is aligned with 1.5°C.", ["F5"], /1\.5°C/],
    ["wrong metric for the cited fact", "Scope 3 emissions were 55,200 tCO2e in FY2025.", ["F1"], /mentions Scope 3/],
    ["number with the wrong year", "Scope 1 emissions were 55,200 tCO2e in FY2024.", ["F1"], /not given for 2024/],
    ["number with the wrong unit", "Scope 1 emissions were 55,200 MWh in FY2025.", ["F1"], /does not match the unit/],
    ["derived change presented as reported", "Apple reported that Scope 1 emissions fell 8% in FY2025.", ["F2"], /calculated change/],
    ["gap described with the wrong state", "The company does not disclose water withdrawal.", ["F3"], /mentions not disclosed/],
    ["parent-only value stated as the group's", "Renewable electricity was 40 % in FY2026.", ["F4"], /drops the "parent only" boundary/],
    ["partial coverage dropped", "Waste generated was 12,000 t in 2025.", ["F7"], /partial coverage/],
    ["rounded number", "Scope 3 emissions were about 14.5 million tCO2e in FY2025.", ["F6"], /"14.5" is not in the facts|spelled-out/],
    ["invented number", "Scope 1 emissions were 55,200 tCO2e in FY2025, 3% of the total.", ["F1"], /"3" is not in the facts/],
    ["citing a fact that does not exist", "Scope 1 emissions were 55,200 tCO2e in FY2025.", ["F99"], /unknown fact F99/],
    ["judgement adjective", "Scope 1 emissions were a modest 55,200 tCO2e in FY2025.", ["F1"], /judgement or magnitude/],
    ["forecast", "Scope 1 emissions will keep falling after FY2025.", ["F2"], /forecast/],
  ];
  for (const [name, text, citations, expected] of cases) {
    it(`rejects ${name}`, () => {
      const r = one(text, citations);
      expect(r.ok).toBe(false);
      expect(r.problems.join("\n")).toMatch(expected);
    });
  }

  it("marks wording-only failures as reviewable and unsupported claims as not", () => {
    expect(one("Scope 1 emissions were a modest 55,200 tCO2e in FY2025.", ["F1"]).reviewable).toBe(true);
    expect(one("Scope 1 emissions were 55,200 tCO2e in FY2025 due to efficiency.", ["F1"]).reviewable).toBe(false);
  });
});

describe("manual-review fallback", () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    const t = tempDataDir();
    dir = t.dir;
    cleanup = t.cleanup;
    cpSync(path.join(REAL_DATA, "sbti.json"), path.join(dir, "sbti.json"));
  });
  afterEach(() => {
    closePipelineDbs();
    cleanup();
  });
  const fake = (sentences: Sentence[]) =>
    ({ beta: { messages: { parse: async () => ({ stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, parsed_output: { sentences } }) } } }) as never;

  it("keeps a wording-only failure for a reviewer, publishes only after approval with a note, and labels it", async () => {
    const db = pipelineDb(dir);
    const apple = loadCompanies(dir).companies.find((c) => c.profile.id === "apple")!;
    const facts = buildFacts(apple, sbtiFor(loadSbti(dir), "apple"));
    const s1 = facts.find((x) => x.text.startsWith("Scope 1 GHG emissions"))!;
    const yr = /FY(\d{4})/.exec(s1.text)![1];
    const r = await summarizeCompany(db, "apple", "Rev", {
      dataDir: dir,
      client: fake([
        { text: `Apple reported Scope 1 GHG emissions of 55,200 tCO2e in FY${yr}, a modest figure.`, citations: [s1.id] },
        { text: `The value covers the consolidated group in FY${yr}.`, citations: [s1.id] },
      ]),
    });
    expect(r).toMatchObject({ ok: false, reviewable: true });
    expect(readSummary("apple", dir)).toBeNull();
    const [c] = listCandidates(db, "pending");
    expect(() => reviewCandidate(db, c.id, "Rev", "approve", "ok", { dataDir: dir })).toThrow(SummaryReviewError);
    reviewCandidate(db, c.id, "Rev", "approve", "Modest is descriptive wording only; the number matches F1.", { dataDir: dir });
    const pub = readSummary("apple", dir)!;
    expect(pub.humanReview).toMatchObject({ by: "Rev", problems: [expect.stringMatching(/modest/)] });
    expect(() => reviewCandidate(db, c.id, "Rev", "approve", "Second approval attempt here.", { dataDir: dir })).toThrow(/not pending/);
  });

  it("stores an unsupported summary as rejected_auto, which nobody can approve", async () => {
    const db = pipelineDb(dir);
    const r = await summarizeCompany(db, "apple", "Rev", { dataDir: dir, client: fake([{ text: "Emissions fell because of solar panels.", citations: ["F1"] }, { text: "It leads its peers.", citations: ["F1"] }]) });
    expect(r).toMatchObject({ ok: false, reviewable: false });
    expect(listCandidates(db, "pending")).toHaveLength(0);
    const [auto] = listCandidates(db, "rejected_auto");
    expect(() => reviewCandidate(db, auto.id, "Rev", "approve", "Looks fine to me, approving anyway.", { dataDir: dir })).toThrow(/not pending/);
    expect(readSummary("apple", dir)).toBeNull();
  });
});
