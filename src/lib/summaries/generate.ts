/**
 * AI summaries (phase 6): Claude writes a short plain-language summary of one
 * company from its numbered facts only, citing fact ids per sentence. The
 * result is published only if checkSummary passes (see check.ts).
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Fact } from "./facts";
import { checkSummary, type CheckResult, type Sentence } from "./check";

export const SUMMARY_MODEL = "claude-opus-5-5";

const Output = z.object({
  sentences: z.array(z.object({ text: z.string(), citations: z.array(z.string()) })),
});

const INSTRUCTIONS = `You write a short, neutral summary of one company's sustainability disclosures for a general reader.

Use ONLY the numbered facts provided. Rules:
- Write 3 to 5 sentences, each at most 40 words.
- Every sentence lists in "citations" the ids of the facts it uses (for example ["F2", "F5"]).
- Copy every number exactly as it appears in a cited fact (same digits, separators and decimals), including years. Do not round, convert, add or compute anything, and do not spell numbers out in words.
- Do not compare with other companies, rank, or judge (no "strong", "leading", "impressive", "poor"). Do not forecast.
- Mention important gaps where relevant, using the fact's own words ("not disclosed", "not found" or "not assessed").
- Keep the company's own wording for targets; say "the company states" for claims such as SBTi validation. Never say a target is on track, achieved, missed or aligned with a temperature goal unless a cited fact says so.
- Describe a rise or fall only from a fact marked "derived" that states the change, in the same direction, and say it is calculated from reported figures. One year's value is not a trend.
- Keep the fact's year and unit with every number, and keep its qualifiers: if a fact says "parent only", "subsidiary only", "not stated" or gives a coverage, say so in the sentence.
- Do not explain causes (no "due to", "driven by", "because") and do not describe changes as improvements or deteriorations.`;

export interface GenerateResult {
  sentences: Sentence[];
  check: CheckResult;
  inputTokens: number;
  outputTokens: number;
}

export async function generateSummary(companyName: string, facts: Fact[], client: Anthropic = new Anthropic()): Promise<GenerateResult> {
  const body = `Company: ${companyName}\n\nFacts:\n${facts.map((f) => `${f.id}: ${f.text}`).join("\n")}`;
  const response = await client.beta.messages.parse({
    model: SUMMARY_MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Output) },
    system: INSTRUCTIONS,
    messages: [{ role: "user", content: body }],
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new Error(`Claude did not return a summary (${response.stop_reason})`);
  }
  const sentences = response.parsed_output.sentences.map((s) => ({ text: s.text.trim(), citations: [...new Set(s.citations)] }));
  return { sentences, check: checkSummary(sentences, facts), inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
}
