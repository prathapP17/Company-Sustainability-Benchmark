/**
 * Access control for the review pipeline (phase 5: accounts and roles).
 *
 * Two modes:
 *  - Local (APP_ORIGIN unset): only requests to localhost are served, and
 *    tunnel/CDN headers are refused, as in phase 3.
 *  - Hosted (APP_ORIGIN=https://your.domain): only requests whose Host is that
 *    domain are served; the app runs behind the bundled Caddy proxy.
 * In both modes a signed-in account is required, with a role:
 *    viewer   download exports and reports, manage own account
 *    reviewer also read the review queue, documents, alerts, discovered reports; upload, fetch, approve/reject
 *    admin    also manage accounts and read the audit log
 * State-changing requests must come from the app's own origin (CSRF).
 *
 * Lesson learned: access is checked in every page and route handler, never
 * only in a layout.
 */
import { countUsers, hasRole, sessionUser, type PublicUser, type Role } from "../auth/accounts";
import { pipelineDb } from "./db";

export const COOKIE = "csi_session";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export interface HeaderLike {
  get(name: string): string | null;
}

export type SignedIn = PublicUser & { tokenHash: string };

export type AccessResult =
  | { ok: true; reviewer: string; user: SignedIn }
  | { ok: false; status: 401 | 403 | 404; reason: string; noAccounts?: boolean };

/** The public origin in hosted mode, e.g. "https://benchmark.example.org"; null in local mode. */
export function appOrigin(): URL | null {
  const v = process.env.APP_ORIGIN?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  return h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0];
}

/**
 * Local mode. Next.js itself adds x-forwarded-for/-host/-proto/-port, so those
 * headers are allowed only when every value points at this machine. Tunnel/CDN
 * headers (Cloudflare, Forwarded, X-Real-IP) are always refused.
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

/** Whether this request is addressed to where the pipeline may be served. */
export function allowedHost(headers: HeaderLike): boolean {
  const origin = appOrigin();
  if (!origin) return isLocal(headers);
  return (headers.get("host") ?? "").trim().toLowerCase() === origin.host.toLowerCase();
}

function placeReason(): string {
  return appOrigin() ? `The review area is only served at ${appOrigin()!.origin}.` : "The review area is only available on this computer (localhost).";
}

/** Client address for throttling: the rightmost X-Forwarded-For entry (set by Next.js, or by the bundled proxy). */
export function clientIp(headers: HeaderLike): string {
  const xff = headers.get("x-forwarded-for");
  return xff?.split(",").pop()?.trim() || "unknown";
}

/** Gate for pages and handlers. `min` is the least role allowed. */
export function checkAccess(headers: HeaderLike, cookieValue: string | undefined, min: Role = "viewer"): AccessResult {
  if (!allowedHost(headers)) return { ok: false, status: 403, reason: placeReason() };
  const db = pipelineDb();
  const user = sessionUser(db, cookieValue);
  if (!user) {
    if (countUsers(db) === 0) {
      return { ok: false, status: 401, noAccounts: true, reason: "No accounts exist yet. Create the first admin from the command line (see below)." };
    }
    return { ok: false, status: 401, reason: "Sign in to use the review area." };
  }
  if (!hasRole(user.role, min)) return { ok: false, status: 403, reason: `This needs the ${min} role; your account is ${user.role}.` };
  return { ok: true, reviewer: user.name, user };
}

/** Additional gate for state-changing requests (CSRF): Origin must be the app's own. */
export function checkSameOrigin(headers: HeaderLike): boolean {
  const origin = headers.get("origin");
  if (!origin) return false;
  try {
    const o = new URL(origin);
    const app = appOrigin();
    if (app) return o.origin === app.origin;
    return o.host === headers.get("host");
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

/** For route handlers: returns the signed-in user, or a Response to send back. */
export function guardRequest(req: Request, opts: { mutating: boolean; role?: Role }): { reviewer: string; user: SignedIn } | Response {
  if (opts.mutating && !checkSameOrigin(req.headers)) {
    return Response.json({ error: "cross-origin request refused" }, { status: 403, headers: NO_STORE });
  }
  const access = checkAccess(req.headers, cookieFrom(req.headers), opts.role ?? (opts.mutating ? "reviewer" : "viewer"));
  if (!access.ok) return Response.json({ error: access.reason }, { status: access.status, headers: NO_STORE });
  return { reviewer: access.reviewer, user: access.user };
}

export const NO_STORE = { "Cache-Control": "no-store" };

/** The session cookie: HttpOnly, SameSite=Strict, Secure when served over HTTPS. */
export function sessionCookie(token: string | null, maxAgeSeconds: number): string {
  const secure = appOrigin()?.protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token ? encodeURIComponent(token) : ""}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? maxAgeSeconds : 0}${secure}`;
}
