/**
 * Polite HTTP client for discovery.
 *
 * - Identifies itself with a generic bot name (never personal details).
 *   SEC EDGAR requires a contact in the User-Agent; that comes only from
 *   SEC_USER_AGENT in .env.local, set by the user.
 * - Checks robots.txt before every request, including each redirect hop.
 * - Rate-limits per host and caps response sizes.
 * - Recognises bot-protection challenges (Cloudflare, Imperva, Akamai) and
 *   reports them as BLOCKED. It never retries around them.
 */
import type { DB } from "../db/connection";
import { robotsFrom, type Robots } from "./robots";

export const BOT_NAME = "CorporateSustainabilityIntelligence";
export const DEFAULT_UA = `${BOT_NAME}/0.4 (sustainability disclosure research; respects robots.txt)`;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  userAgent?: string;
  hostIntervalMs: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface HttpResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  headers: Headers;
  body: Buffer | null;
  blocked?: string;
  error?: string;
}

const CHALLENGE_MARKERS = [/just a moment\.\.\./i, /attention required! \| cloudflare/i, /incapsula incident/i, /_incapsula_resource/i, /access denied.*akamai/i, /captcha/i];

/** Bot protection, not an ordinary error: never retried, recorded as a blocker. */
export function detectChallenge(status: number, headers: Headers, bodySample: string): string | null {
  if (headers.get("cf-mitigated")) return `Cloudflare challenge (HTTP ${status})`;
  if (headers.get("x-iinfo") || /incap_ses|visid_incap/.test(headers.get("set-cookie") ?? "")) return `Imperva protection (HTTP ${status})`;
  if ((status === 403 || status === 429 || status === 503) && CHALLENGE_MARKERS.some((m) => m.test(bodySample))) {
    return `bot protection page (HTTP ${status})`;
  }
  if (status === 403) return "HTTP 403 (access refused to automated clients)";
  return null;
}

export class PoliteHttp {
  private lastRequest = new Map<string, number>();
  private robots = new Map<string, Robots>();
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  readonly userAgent: string;
  requests = 0;

  constructor(
    private readonly db: DB,
    private readonly opts: HttpOptions,
  ) {
    this.fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
    this.userAgent = opts.userAgent ?? DEFAULT_UA;
  }

  private async throttle(host: string) {
    const last = this.lastRequest.get(host);
    if (last !== undefined) {
      const wait = last + this.opts.hostIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.lastRequest.set(host, this.now());
  }

  private async raw(url: string, method: "GET" | "HEAD", accept: string): Promise<Response> {
    const u = new URL(url);
    await this.throttle(u.host);
    this.requests++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 30_000);
    try {
      return await this.fetchImpl(url, {
        method,
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "User-Agent": this.userAgent, Accept: accept, "Accept-Language": "en" },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async robotsFor(origin: string): Promise<Robots> {
    const cached = this.robots.get(origin);
    if (cached) return cached;
    const row = this.db.prepare("SELECT * FROM robots_cache WHERE origin = ?").get(origin) as
      | { fetched_at: string; status: number; body: string | null }
      | undefined;
    let status: number;
    let body: string | null;
    if (row && this.now() - Date.parse(row.fetched_at) < 24 * 3600_000) {
      status = row.status;
      body = row.body;
    } else {
      try {
        // RFC 9309 §2.3.1.2: follow at least five redirects for robots.txt.
        let target = `${origin}/robots.txt`;
        let res = await this.raw(target, "GET", "text/plain");
        for (let hop = 0; hop < 5 && res.status >= 300 && res.status < 400 && res.headers.get("location"); hop++) {
          await res.body?.cancel();
          target = new URL(res.headers.get("location")!, target).toString();
          res = await this.raw(target, "GET", "text/plain");
        }
        status = res.status;
        // A redirect loop that never resolves counts as unreachable (treated like 5xx: disallow).
        if (status >= 300 && status < 400) status = 599;
        body = status < 300 ? (await res.text()).slice(0, 500_000) : null;
        if (body === null) await res.body?.cancel().catch(() => {});
      } catch {
        status = 599;
        body = null;
      }
      this.db
        .prepare("INSERT INTO robots_cache (origin, fetched_at, status, body) VALUES (?, ?, ?, ?) ON CONFLICT(origin) DO UPDATE SET fetched_at=excluded.fetched_at, status=excluded.status, body=excluded.body")
        .run(origin, new Date(this.now()).toISOString(), status, body);
    }
    const r = robotsFrom(body, status, BOT_NAME);
    this.robots.set(origin, r);
    return r;
  }

  async allowed(url: string): Promise<boolean> {
    const u = new URL(url);
    return (await this.robotsFor(u.origin)).isAllowed(u.pathname + u.search);
  }

  /** GET or HEAD with robots checks on every hop, a size cap, and challenge detection. */
  async request(url: string, opts: { method?: "GET" | "HEAD"; maxBytes: number; accept?: string }): Promise<HttpResult> {
    let current = url;
    for (let hop = 0; hop < 6; hop++) {
      const u = new URL(current);
      if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, status: 0, finalUrl: current, headers: new Headers(), body: null, error: "unsupported scheme" };
      if (!(await this.allowed(current))) {
        return { ok: false, status: 0, finalUrl: current, headers: new Headers(), body: null, error: "disallowed by robots.txt" };
      }
      let res: Response;
      try {
        res = await this.raw(current, opts.method ?? "GET", opts.accept ?? "*/*");
      } catch (e) {
        return { ok: false, status: 0, finalUrl: current, headers: new Headers(), body: null, error: (e as Error).name === "AbortError" ? "timed out" : (e as Error).message };
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, current).toString();
        continue;
      }
      if (opts.method === "HEAD") {
        const blocked = res.status >= 400 ? detectChallenge(res.status, res.headers, "") : null;
        return { ok: res.ok, status: res.status, finalUrl: current, headers: res.headers, body: null, blocked: blocked ?? undefined };
      }
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > opts.maxBytes) {
        await res.body?.cancel();
        return { ok: false, status: res.status, finalUrl: current, headers: res.headers, body: null, error: `larger than ${Math.round(opts.maxBytes / 1048576)} MB` };
      }
      const chunks: Buffer[] = [];
      let size = 0;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > opts.maxBytes) {
            await reader.cancel();
            return { ok: false, status: res.status, finalUrl: current, headers: res.headers, body: null, error: `larger than ${Math.round(opts.maxBytes / 1048576)} MB` };
          }
          chunks.push(Buffer.from(value));
        }
      }
      const body = Buffer.concat(chunks);
      if (!res.ok) {
        const blocked = detectChallenge(res.status, res.headers, body.subarray(0, 20_000).toString("utf8"));
        return { ok: false, status: res.status, finalUrl: current, headers: res.headers, body, blocked: blocked ?? undefined, error: `HTTP ${res.status}` };
      }
      return { ok: true, status: res.status, finalUrl: current, headers: res.headers, body };
    }
    return { ok: false, status: 0, finalUrl: current, headers: new Headers(), body: null, error: "too many redirects" };
  }
}

