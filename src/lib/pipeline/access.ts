/**
 * Phase 3 access control for the pipeline (until accounts arrive in phase 5):
 *
 * 1. Disabled unless REVIEWER_TOKEN (≥ 16 chars) is set in .env.local.
 * 2. Local requests only: Host must be localhost/127.0.0.1/::1 and no proxy
 *    or tunnel headers may be present.
 * 3. A signed, httpOnly, SameSite=Strict cookie after entering the token and
 *    a reviewer name; the name goes into the audit trail.
 * 4. State-changing requests must come from the same origin.
 *
 * Lesson learned: access is checked in every page and route handler, never
 * only in a layout.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE = "csi_reviewer";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export interface HeaderLike {
  get(name: string): string | null;
}

export type AccessResult =
  | { ok: true; reviewer: string }
  | { ok: false; status: 401 | 403 | 404; reason: string };

function token(): string | null {
  const t = process.env.REVIEWER_TOKEN?.trim();
  return t && t.length >= 16 ? t : null;
}

export function pipelineEnabled(): boolean {
  return token() !== null;
}

const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  return h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0];
}

/**
 * Next.js itself adds x-forwarded-for/-host/-proto/-port, so those headers are
 * allowed only when every value points at this machine. Tunnel/CDN headers
 * (Cloudflare, Forwarded, X-Real-IP) are always refused.
 */
export function isLocal(headers: HeaderLike): boolean {
  if (!LOCAL_HOSTS.has(hostnameOf(headers.get("host") ?? ""))) return false;
  for (const h of ["cf-connecting-ip", "cf-ray", "forwarded", "x-real-ip"]) if (headers.get(h)) return false;
  const xfh = headers.get("x-forwarded-host");
  if (xfh && !xfh.split(",").every((v) => LOCAL_HOSTS.has(hostnameOf(v)))) return false;
  const xff = headers.get("x-forwarded-for");
  if (xff && !xff.split(",").every((v) => LOOPBACK_IPS.has(v.trim()))) return false;
  return true;
}

function sign(name: string, secret: string) {
  return createHmac("sha256", secret).update(`reviewer:${name}`).digest("base64url");
}

export function makeCookieValue(name: string): string {
  const secret = token();
  if (!secret) throw new Error("pipeline disabled");
  return `${Buffer.from(name, "utf8").toString("base64url")}.${sign(name, secret)}`;
}

export function readCookieValue(value: string | undefined): string | null {
  const secret = token();
  if (!secret || !value) return null;
  const [encName, sig] = value.split(".");
  if (!encName || !sig) return null;
  const name = Buffer.from(encName, "base64url").toString("utf8");
  const expected = Buffer.from(sign(name, secret));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  return name;
}

export function checkToken(candidate: string): boolean {
  const secret = token();
  if (!secret) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(candidate);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cleanReviewerName(name: string): string {
  return name.replace(/[^\p{L}\p{N} .'-]/gu, "").trim().slice(0, 60);
}

/** Gate for pages and GET handlers. */
export function checkAccess(headers: HeaderLike, cookieValue: string | undefined): AccessResult {
  if (!pipelineEnabled()) return { ok: false, status: 404, reason: "The review pipeline is disabled (REVIEWER_TOKEN not set)." };
  if (!isLocal(headers)) return { ok: false, status: 403, reason: "The review pipeline is only available on this computer (localhost)." };
  const reviewer = readCookieValue(cookieValue);
  if (!reviewer) return { ok: false, status: 401, reason: "Sign in with the reviewer token." };
  return { ok: true, reviewer };
}

/** Additional gate for state-changing requests (CSRF): Origin must match Host. */
export function checkSameOrigin(headers: HeaderLike): boolean {
  const origin = headers.get("origin");
  const host = headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Parses the cookie header (route handlers receive raw Request objects). */
export function cookieFrom(headers: HeaderLike, name = COOKIE): string | undefined {
  const raw = headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/** For route handlers: returns the reviewer, or a Response to send back. */
export function guardRequest(req: Request, mutating: boolean): { reviewer: string } | Response {
  const access = checkAccess(req.headers, cookieFrom(req.headers));
  if (!access.ok) return Response.json({ error: access.reason }, { status: access.status });
  if (mutating && !checkSameOrigin(req.headers)) return Response.json({ error: "cross-origin request refused" }, { status: 403 });
  return { reviewer: access.reviewer };
}
