import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AccountError,
  changePassword,
  checkLink,
  hashPassword,
  inviteUser,
  IP_MAX_ATTEMPTS,
  login,
  logout,
  MAX_FAILED_LOGINS,
  newPasswordLink,
  passwordProblem,
  revokeSessions,
  sessionUser,
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
  setDisabled,
  setPasswordWithLink,
  setRole,
  verifyPassword,
} from "@/lib/auth/accounts";
import { checkAccess, checkSameOrigin, clientIp, isLocal, sessionCookie } from "@/lib/pipeline/access";
import { closePipelineDbs, pipelineDb } from "@/lib/pipeline/db";
import { tempDataDir } from "./helpers";

const H = (h: Record<string, string>) => new Headers(h);
const PW = "correct horse battery staple";
const META = { ip: "203.0.113.5", userAgent: "vitest" };

let dir: string;
let cleanup: () => void;
beforeEach(() => {
  const t = tempDataDir(false);
  dir = t.dir;
  cleanup = t.cleanup;
  process.env.CSI_DATA_DIR = dir; // rule 9: never the real data folder
  delete process.env.APP_ORIGIN;
});
afterEach(() => {
  closePipelineDbs();
  cleanup();
  delete process.env.CSI_DATA_DIR;
  delete process.env.APP_ORIGIN;
});

const db = () => pipelineDb(dir);
/** Creates an account with a password set; returns its id. */
function account(email: string, name: string, role: "admin" | "reviewer" | "viewer") {
  const { user, token } = inviteUser(db(), { email, name, role }, "test");
  setPasswordWithLink(db(), token, PW);
  return user.id;
}
const signIn = (email: string, now?: Date) => {
  const r = login(db(), email, PW, META, now);
  if (!r.ok) throw new Error(r.error);
  return r.token;
};

describe("passwords and one-time links", () => {
  it("hashes with scrypt and a per-password salt", () => {
    const a = hashPassword(PW);
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(a).not.toBe(hashPassword(PW));
    expect(verifyPassword(PW, a)).toBe(true);
    expect(verifyPassword(`${PW}!`, a)).toBe(false);
  });

  it("refuses short or self-referencing passwords", () => {
    expect(passwordProblem("short")).toMatch(/at least 12/);
    expect(passwordProblem("aaaaaaaaaaaaaa")).toMatch(/repeat/);
    expect(passwordProblem("my-alex.smith-passphrase", { email: "alex.smith@example.org", name: "Alex Smith" })).toMatch(/email/);
    expect(passwordProblem(PW)).toBeNull();
  });

  it("invite links work once, expire, and are stored only as hashes", () => {
    const now = new Date("2026-11-25T10:00:00Z");
    const { user, token } = inviteUser(db(), { email: "Ana@Example.org", name: "Ana", role: "reviewer" }, "admin", now);
    expect(user.email).toBe("ana@example.org");
    expect(JSON.stringify(db().prepare("SELECT * FROM account_links").all())).not.toContain(token);
    expect(checkLink(db(), token, now)).toMatchObject({ purpose: "invite", user: { name: "Ana" } });
    expect(() => setPasswordWithLink(db(), token, "too short", now)).toThrow(/at least 12/);
    // Expired after 72 hours.
    expect(checkLink(db(), token, new Date(now.getTime() + 73 * 3600_000))).toBeNull();
    setPasswordWithLink(db(), token, PW, now);
    expect(() => setPasswordWithLink(db(), token, PW, now)).toThrow(AccountError); // used
    expect(() => inviteUser(db(), { email: "ana@example.org", name: "Other", role: "viewer" }, "admin")).toThrow(/already exists/);
    expect(() => inviteUser(db(), { email: "b@example.org", name: "ana", role: "viewer" }, "admin")).toThrow(/name/);
  });
});

describe("sign-in", () => {
  it("signs in, stores only a hash of the session token, and signs out", () => {
    account("rev@example.org", "Rev", "reviewer");
    const token = signIn("rev@example.org");
    expect(JSON.stringify(db().prepare("SELECT * FROM sessions").all())).not.toContain(token);
    expect(sessionUser(db(), token)).toMatchObject({ name: "Rev", role: "reviewer" });
    logout(db(), token);
    expect(sessionUser(db(), token)).toBeNull();
  });

  it("gives the same answer for unknown emails and wrong passwords", () => {
    account("rev@example.org", "Rev", "reviewer");
    const a = login(db(), "nobody@example.org", PW, META);
    const b = login(db(), "rev@example.org", "wrong password here", META);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: false, status: 401 });
  });

  it(`locks an account for 15 minutes after ${MAX_FAILED_LOGINS} wrong passwords`, () => {
    account("rev@example.org", "Rev", "reviewer");
    const now = new Date("2026-11-25T10:00:00Z");
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) login(db(), "rev@example.org", "wrong password here", { ...META, ip: `198.51.100.${i}` }, now);
    expect(login(db(), "rev@example.org", PW, META, now)).toMatchObject({ ok: false, status: 429 }); // even the right password
    expect(login(db(), "rev@example.org", PW, META, new Date(now.getTime() + 16 * 60_000)).ok).toBe(true);
  });

  it(`throttles one address after ${IP_MAX_ATTEMPTS} attempts in 15 minutes`, () => {
    account("rev@example.org", "Rev", "reviewer");
    const now = new Date("2026-11-25T10:00:00Z");
    for (let i = 0; i < IP_MAX_ATTEMPTS; i++) login(db(), `x${i}@example.org`, "whatever-password", META, now);
    expect(login(db(), "rev@example.org", PW, META, now)).toMatchObject({ ok: false, status: 429 });
    expect(login(db(), "rev@example.org", PW, { ...META, ip: "192.0.2.1" }, now).ok).toBe(true);
  });

  it("ends sessions after 8 idle hours or 7 days, and when the account is disabled", () => {
    account("admin@example.org", "Admin", "admin");
    const id = account("rev@example.org", "Rev", "reviewer");
    const t0 = new Date("2026-11-25T10:00:00Z");
    const idle = signIn("rev@example.org", t0);
    expect(sessionUser(db(), idle, new Date(t0.getTime() + SESSION_IDLE_MS + 1000))).toBeNull();

    const busy = signIn("rev@example.org", t0);
    let t = t0.getTime();
    while (t + 6 * 3600_000 < t0.getTime() + SESSION_MAX_MS) {
      t += 6 * 3600_000; // active every 6 hours
      expect(sessionUser(db(), busy, new Date(t))).not.toBeNull();
    }
    expect(sessionUser(db(), busy, new Date(t0.getTime() + SESSION_MAX_MS + 1000))).toBeNull();

    const s = signIn("rev@example.org");
    setDisabled(db(), id, true, "Admin");
    expect(sessionUser(db(), s)).toBeNull();
    expect(login(db(), "rev@example.org", PW, META).ok).toBe(false);
  });

  it("password changes and resets sign out other sessions", () => {
    const id = account("rev@example.org", "Rev", "reviewer");
    const here = signIn("rev@example.org");
    const other = signIn("rev@example.org");
    const keep = sessionUser(db(), here)!.tokenHash;
    expect(() => changePassword(db(), id, "wrong password here", "another long passphrase", keep)).toThrow(/current password/);
    changePassword(db(), id, PW, "another long passphrase", keep);
    expect(sessionUser(db(), here)).not.toBeNull();
    expect(sessionUser(db(), other)).toBeNull();

    const { purpose } = newPasswordLink(db(), id, "admin");
    expect(purpose).toBe("reset");
    expect(sessionUser(db(), here)).toBeNull(); // a reset ends every session
    expect(revokeSessions(db(), id, "admin")).toBe(0);
  });
});

describe("roles and admin safety", () => {
  it("applies role changes on the next request and keeps one active admin", () => {
    const admin = account("admin@example.org", "Admin", "admin");
    const rev = account("rev@example.org", "Rev", "reviewer");
    const local = H({ host: "localhost:3000" });
    const token = signIn("rev@example.org");
    expect(checkAccess(local, token, "reviewer")).toMatchObject({ ok: true, reviewer: "Rev" });
    expect(checkAccess(local, token, "admin")).toMatchObject({ ok: false, status: 403 });
    setRole(db(), rev, "viewer", "Admin");
    expect(checkAccess(local, token, "reviewer")).toMatchObject({ ok: false, status: 403 });
    expect(checkAccess(local, token, "viewer").ok).toBe(true);

    expect(() => setRole(db(), admin, "reviewer", "Admin")).toThrow(/at least one active admin/);
    expect(() => setDisabled(db(), admin, true, "Admin")).toThrow(/at least one active admin/);
    setRole(db(), rev, "admin", "Admin");
    setRole(db(), admin, "reviewer", "Rev"); // allowed now: another admin exists
  });

  it("explains how to create the first admin when no accounts exist", () => {
    expect(checkAccess(H({ host: "localhost:3000" }), undefined)).toMatchObject({ ok: false, status: 401, noAccounts: true });
    account("admin@example.org", "Admin", "admin");
    const after = checkAccess(H({ host: "localhost:3000" }), undefined);
    expect(after).toMatchObject({ ok: false, status: 401 });
    expect(!after.ok && after.noAccounts).toBeFalsy();
  });
});

describe("where the review area is served", () => {
  it("local mode: localhost only, no proxy or tunnel headers", () => {
    expect(isLocal(H({ host: "localhost:3000" }))).toBe(true);
    expect(isLocal(H({ host: "127.0.0.1:3000" }))).toBe(true);
    expect(isLocal(H({ host: "[::1]:3000" }))).toBe(true);
    expect(isLocal(H({ host: "example.trycloudflare.com" }))).toBe(false);
    expect(isLocal(H({ host: "localhost:3000", "cf-connecting-ip": "1.2.3.4" }))).toBe(false);
    expect(isLocal(H({ host: "localhost:3000", "x-forwarded-for": "1.2.3.4" }))).toBe(false);
    // Next.js adds its own forwarded headers for local requests; those are fine.
    expect(isLocal(H({ host: "localhost:3000", "x-forwarded-for": "::1", "x-forwarded-host": "localhost:3000" }))).toBe(true);
    expect(isLocal(H({ host: "localhost:3000", "x-forwarded-for": "127.0.0.1, 8.8.8.8" }))).toBe(false);
    expect(isLocal(H({ host: "localhost:3000", "x-forwarded-host": "evil.example" }))).toBe(false);
    expect(checkSameOrigin(H({ host: "localhost:3000", origin: "http://localhost:3000" }))).toBe(true);
    expect(checkSameOrigin(H({ host: "localhost:3000", origin: "http://evil.example" }))).toBe(false);
    expect(checkSameOrigin(H({ host: "localhost:3000" }))).toBe(false);
    expect(sessionCookie("abc", 60)).not.toContain("Secure");
  });

  it("hosted mode: only the configured origin, Secure cookie, client address from the proxy", () => {
    process.env.APP_ORIGIN = "https://bench.example.org";
    account("rev@example.org", "Rev", "reviewer");
    const token = signIn("rev@example.org");
    expect(checkAccess(H({ host: "bench.example.org" }), token).ok).toBe(true);
    expect(checkAccess(H({ host: "localhost:3000" }), token)).toMatchObject({ ok: false, status: 403 });
    expect(checkAccess(H({ host: "other.example.org" }), token)).toMatchObject({ ok: false, status: 403 });
    expect(checkSameOrigin(H({ host: "bench.example.org", origin: "https://bench.example.org" }))).toBe(true);
    expect(checkSameOrigin(H({ host: "bench.example.org", origin: "http://bench.example.org" }))).toBe(false); // scheme matters
    expect(sessionCookie("abc", 60)).toMatch(/HttpOnly; SameSite=Strict; Max-Age=60; Secure$/);
    expect(clientIp(H({ "x-forwarded-for": "10.0.0.9, 203.0.113.7" }))).toBe("203.0.113.7");
  });
});

describe("role hierarchy (brief section 7: guest < viewer < reviewer < admin)", () => {
  const local = H({ host: "localhost:3000" });
  it("each role gets exactly the operations at or below it", () => {
    account("admin@example.org", "Admin", "admin");
    account("rev@example.org", "Rev", "reviewer");
    account("view@example.org", "View", "viewer");
    const tokens = { admin: signIn("admin@example.org"), reviewer: signIn("rev@example.org"), viewer: signIn("view@example.org") };
    const allowed = (who: keyof typeof tokens | "guest", min: "viewer" | "reviewer" | "admin") =>
      checkAccess(local, who === "guest" ? undefined : tokens[who], min).ok;
    const matrix = {
      guest: { viewer: false, reviewer: false, admin: false },
      viewer: { viewer: true, reviewer: false, admin: false },
      reviewer: { viewer: true, reviewer: true, admin: false },
      admin: { viewer: true, reviewer: true, admin: true },
    };
    for (const [who, row] of Object.entries(matrix)) {
      for (const [min, expected] of Object.entries(row)) {
        expect(allowed(who as keyof typeof matrix, min as "viewer"), `${who} on ${min}`).toBe(expected);
      }
    }
    expect(checkAccess(local, undefined, "viewer")).toMatchObject({ status: 401 });
    expect(checkAccess(local, tokens.viewer, "reviewer")).toMatchObject({ status: 403, reason: expect.stringMatching(/needs the reviewer role/) });
  });

  it("every protected page and route asks for the role the brief gives that operation", async () => {
    const { readFileSync } = await import("node:fs");
    const src = (p: string) => readFileSync(p, "utf8");
    const pageRole = (p: string) => /currentAccess\(("(\w+)")?\)/.exec(src(p))?.[2] ?? "viewer";
    const routeRoles = (p: string) => [...src(p).matchAll(/guardRequest\(req, \{ mutating: (true|false)(?:, role: "(\w+)")? \}\)/g)].map((m) => m[2] ?? (m[1] === "true" ? "reviewer" : "viewer"));
    // Pages
    expect(pageRole("src/app/review/page.tsx")).toBe("viewer"); // viewer landing; the queue itself checks reviewer
    expect(src("src/app/review/page.tsx")).toMatch(/if \(!hasRole\(access\.user\.role, "reviewer"\)\)/);
    for (const p of ["alerts", "discovered", "news", "summaries", "documents/[id]"]) expect(pageRole(`src/app/review/${p}/page.tsx`), p).toBe("reviewer");
    for (const p of ["audit", "users"]) expect(pageRole(`src/app/review/${p}/page.tsx`), p).toBe("admin");
    expect(pageRole("src/app/review/account/page.tsx")).toBe("viewer");
    // Routes that change data
    const R = "src/app/api/pipeline";
    for (const p of ["upload", "extractions/[id]", "documents/[id]/requeue", "discovered/[id]", "alerts/[id]", "news/[id]", "summaries/[id]"]) {
      expect(routeRoles(`${R}/${p}/route.ts`), p).toEqual(["reviewer"]);
    }
    for (const p of ["users", "users/[id]"]) expect(routeRoles(`${R}/${p}/route.ts`), p).toEqual(["admin"]);
    for (const p of ["account/password", "account/sessions"]) expect(routeRoles(`${R}/${p}/route.ts`), p).toEqual(["viewer"]);
    // Exports are viewer-and-above and audited
    expect(src("src/lib/export/guard.ts")).toMatch(/role: "viewer"/);
    for (const p of ["values.csv", "benchmark.xlsx", "report.pdf", "report/[id]"]) expect(src(`src/app/api/export/${p}/route.ts`), p).toMatch(/exportAccess\(req/);
  });
});
