/**
 * Minimal robots.txt (RFC 9309) evaluation: groups by user-agent, Allow /
 * Disallow with * and $ wildcards, longest match wins, Allow wins ties.
 */
interface Rule {
  allow: boolean;
  pattern: string;
}

export interface Robots {
  isAllowed(pathAndQuery: string): boolean;
}

function parse(body: string, agentToken: string): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      if (value || key === "allow") current.rules.push({ allow: key === "allow", pattern: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const token = agentToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.rules);
}

function toRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export function robotsFrom(body: string | null, status: number, agentToken: string): Robots {
  // 4xx: no robots file → everything allowed. 5xx / unreachable: assume disallowed (RFC 9309 §2.3.1.4).
  if (status >= 400 && status < 500) return { isAllowed: () => true };
  if (status >= 500 || body === null) return { isAllowed: () => false };
  const rules = parse(body, agentToken);
  return {
    isAllowed(p: string) {
      let best: Rule | null = null;
      for (const r of rules) {
        if (r.pattern === "") continue;
        if (!toRegExp(r.pattern).test(p)) continue;
        if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
      }
      return best ? best.allow : true;
    },
  };
}
