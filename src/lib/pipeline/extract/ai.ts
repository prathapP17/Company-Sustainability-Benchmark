/**
 * Optional Claude extraction. Runs only when ANTHROPIC_API_KEY is set.
 *
 * Claude reads page text (with page markers) and returns structured
 * candidates. Its output is treated exactly like the rule extractor's:
 * PROPOSALS that must pass the evidence gate (value + wording found again on
 * the stored page) and human review. Nothing it says is trusted on its own.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getMetric, METRICS, metricAppliesTo } from "../../metrics/dictionary";
import type { FiscalLabelConvention } from "../../schema/enums";
import type { Candidate, PageInput } from "./rules";
import { detectConsolidation } from "./rules";

export const AI_MODEL = "claude-opus-5-5";
const MAX_PAGES_PER_REQUEST = 30;
const MAX_REQUESTS = 3;
const MAX_CHARS_PER_PAGE = 6000;

export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

const Item = z.object({
  metric_id: z.string(),
  year: z.number().int(),
  value: z.number(),
  unit: z.string(),
  page_number: z.number().int(),
  reported_wording: z.string(),
  boundary: z.enum(["consolidated_group", "parent_only", "subsidiary_only", "not_stated"]),
});
const Output = z.object({ values: z.array(Item) });

/** Ranks pages by how many metric keywords they contain; scanned pages are skipped. */
export function selectPages(pages: PageInput[], peerGroup: string): PageInput[] {
  const words = METRICS.filter((m) => metricAppliesTo(m, peerGroup))
    .flatMap((m) => m.synonyms)
    .filter((s) => /^[\x00-\x7f]+$/.test(s) && s.length > 3)
    .map((s) => s.toLowerCase());
  return pages
    .filter((p) => !p.isScanned && p.text.trim().length > 0)
    .map((p) => {
      const t = p.text.toLowerCase();
      return { p, score: words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PAGES_PER_REQUEST * MAX_REQUESTS)
    .sort((a, b) => a.p.pageNumber - b.p.pageNumber)
    .map((x) => x.p);
}

function instructions(peerGroup: string, convention: FiscalLabelConvention, companyName: string) {
  const metrics = METRICS.filter((m) => metricAppliesTo(m, peerGroup))
    .map((m) => `- ${m.id}: ${m.label}. Accepted units: ${Object.keys(getMetric(m.id).units).join(", ")}`)
    .join("\n");
  return `You extract sustainability metrics for ${companyName} from report pages. Each page starts with a line "=== PAGE <n> ===".

Return only values that are printed on a page as a number for a clearly identified fiscal year. For each value:
- metric_id: one of the ids below.
- year: the company's own fiscal-year label. This company labels fiscal years by their ${
    convention === "start_year" ? "START year (FY2025 = April 2025 to March 2026)" : "END year (\"FY 2025-26\" is 2026)"
  }.
- value and unit exactly as printed (unit must be one of the accepted units; convert nothing).
- page_number: the <n> of the page where the value is printed.
- reported_wording: copy one contiguous line of the page VERBATIM that contains both the row label and the value. It will be checked character by character against the page text.
- boundary: "parent_only" if the page or document says the data is standalone/parent only, "consolidated_group" if it says consolidated group, otherwise "not_stated".

Skip a value if the unit, the year, the boundary of the row, or which metric it is, is ambiguous. Do not compute, add, or convert anything. Omit metrics you do not find; an empty list is a valid answer.

Metrics:
${metrics}`;
}

export interface AiResult {
  candidates: Candidate[];
  requests: number;
  inputTokens: number;
  outputTokens: number;
  dropped: number;
}

export async function extractWithClaude(
  pages: PageInput[],
  ctx: { peerGroup: string; convention: FiscalLabelConvention; companyName: string },
  client: Anthropic = new Anthropic(),
): Promise<AiResult> {
  const selected = selectPages(pages, ctx.peerGroup);
  const byNumber = new Map(pages.map((p) => [p.pageNumber, p]));
  const consolidation = detectConsolidation(pages.map((p) => p.text).join("\n"));
  const result: AiResult = { candidates: [], requests: 0, inputTokens: 0, outputTokens: 0, dropped: 0 };

  for (let i = 0; i < selected.length; i += MAX_PAGES_PER_REQUEST) {
    const chunk = selected.slice(i, i + MAX_PAGES_PER_REQUEST);
    const body = chunk.map((p) => `=== PAGE ${p.pageNumber} ===\n${p.text.slice(0, MAX_CHARS_PER_PAGE)}`).join("\n\n");
    const response = await client.beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      // Server-side fallback if the request is declined by a safety classifier.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(Output) },
      system: instructions(ctx.peerGroup, ctx.convention, ctx.companyName),
      messages: [{ role: "user", content: body }],
    });
    result.requests++;
    result.inputTokens += response.usage.input_tokens;
    result.outputTokens += response.usage.output_tokens;
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens" || !response.parsed_output) {
      throw new Error(`Claude extraction stopped (${response.stop_reason}) on pages ${chunk[0].pageNumber}-${chunk.at(-1)!.pageNumber}`);
    }
    for (const it of response.parsed_output.values) {
      const page = byNumber.get(it.page_number);
      const def = METRICS.find((m) => m.id === it.metric_id);
      // Structural checks; the evidence gate runs later on stored text.
      if (!page || !def || !metricAppliesTo(def, ctx.peerGroup) || getMetric(def.id).units[it.unit] === undefined) {
        result.dropped++;
        continue;
      }
      result.candidates.push({
        metricId: it.metric_id,
        year: it.year,
        value: it.value,
        unit: it.unit,
        pageNumber: it.page_number,
        pageLabel: page.label,
        cell: null,
        reportedWording: it.reported_wording.slice(0, 400),
        boundary: it.boundary,
        consolidation,
        scope2Method: def.id.endsWith("_market") ? "market" : def.id.endsWith("_location") ? "location" : null,
        confidence: 0.6,
      });
    }
  }
  return result;
}
