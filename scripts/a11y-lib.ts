/** Shared accessibility check (axe-core, WCAG 2.0/2.1 A and AA) for the e2e suites. */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "playwright-core";

export interface A11yIssue {
  id: string;
  impact: string | null;
  help: string;
  nodes: string[];
}

export async function auditPage(page: Page): Promise<A11yIssue[]> {
  const r = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations.map((v) => ({ id: v.id, impact: v.impact ?? null, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
}
