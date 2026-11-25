/**
 * Accounts (phase 5): email + password, three roles, invite and reset links.
 *
 * - Passwords: scrypt (N=2^15, r=8, p=1) with a per-user salt; compared in
 *   constant time. Unknown emails still cost one scrypt run, so response
 *   time does not reveal which emails have accounts.
 * - Sessions and one-time links: 32 random bytes handed to the browser;
 *   only their SHA-256 hash is stored.
 * - Brute force: 8 wrong passwords lock the account for 15 minutes, and one
 *   address may try at most 30 times per 15 minutes.
 * - No email is sent: an admin passes the invite or reset link on.
 * Every account change is written to the audit log.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { DB } from "../db/connection";
import { audit } from "../pipeline/db";

export type Role = "admin" | "reviewer" | "viewer";
export const ROLES: Role[] = ["admin", "reviewer", "viewer"];
const RANK: Record<Role, number> = { viewer: 0, reviewer: 1, admin: 2 };
export const hasRole = (role: Role, min: Role) => RANK[role] >= RANK[min];

export const SESSION_IDLE_MS = 8 * 3600_000;
export const SESSION_MAX_MS = 7 * 24 * 3600_000;
export const LINK_TTL_MS = { invite: 72 * 3600_000, reset: 2 * 3600_000 } as const;
export const MAX_FAILED_LOGINS = 8;
export const LOCK_MS = 15 * 60_000;
export const IP_WINDOW_MS = 15 * 60_000;
export const IP_MAX_ATTEMPTS = 30;
export const MIN_PASSWORD = 12;

export interface UserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  password_hash: string | null;
  created_at: string;
  created_by: string;
  disabled_at: string | null;
  failed_logins: number;
  locked_until: string | null;
  last_login_at: string | null;
  password_changed_at: string | null;
}

export type PublicUser = Pick<UserRow, "id" | "email" | "name" | "role">;

export class AccountError extends Error {}

// ---------------------------------------------------------------- hashing

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32 };
const SCRYPT_MAXMEM = 128 * SCRYPT.N * SCRYPT.r * 2;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT_MAXMEM });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, r, p, salt, key] = stored.split("$");
  if (alg !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const got = scryptSync(password, Buffer.from(salt, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT_MAXMEM });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// Spent on unknown emails so they take as long as known ones.
let dummyHash: string | null = null;
const burnTime = (password: string) => verifyPassword(password, (dummyHash ??= hashPassword("not-a-real-password-0000")));

export const newToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

// ---------------------------------------------------------------- validation

export function cleanEmail(email: string): string {
  const e = email.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new AccountError("enter a valid email address");
  return e;
}

export function cleanName(name: string): string {
  const n = name.replace(/[^\p{L}\p{N} .'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (n.length < 2) throw new AccountError("enter a name (at least 2 letters)");
  return n;
}

/** Length is what matters; also refuse passwords built from the account's own details or one repeated character. */
export function passwordProblem(password: string, user?: Pick<UserRow, "email" | "name">): string | null {
  if (password.length < MIN_PASSWORD) return `use at least ${MIN_PASSWORD} characters`;
  if (password.length > 200) return "use at most 200 characters";
  if (/^(.)\1+$/.test(password)) return "do not repeat a single character";
  const lower = password.toLowerCase();
  if (user) {
    const local = user.email.split("@")[0].toLowerCase();
    if (local.length >= 4 && lower.includes(local)) return "do not include your email address";
    if (user.name.length >= 4 && lower.includes(user.name.toLowerCase().replace(/\s+/g, ""))) return "do not include your name";
  }
  if (/^(password|passw0rd|qwerty|letmein|welcome|sustainab)/i.test(password) && password.length < 16) return "choose a less common password";
  return null;
}

// ---------------------------------------------------------------- users

export const toPublic = (u: UserRow): PublicUser => ({ id: u.id, email: u.email, name: u.name, role: u.role });

export const isLocked = (u: Pick<UserRow, "locked_until">, now = new Date()) => !!u.locked_until && Date.parse(u.locked_until) > now.getTime();

export function listUsers(db: DB): UserRow[] {
  return db.prepare("SELECT * FROM users ORDER BY disabled_at IS NOT NULL, role, name").all() as UserRow[];
}

export function getUser(db: DB, id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function userByEmail(db: DB, email: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as UserRow | undefined;
}

export function countUsers(db: DB): number {
  return (db.prepare("SELECT count(*) n FROM users").get() as { n: number }).n;
}

function activeAdmins(db: DB): number {
  return (db.prepare("SELECT count(*) n FROM users WHERE role = 'admin' AND disabled_at IS NULL").get() as { n: number }).n;
}

function createLink(db: DB, userId: number, purpose: "invite" | "reset", actor: string, now = new Date()): string {
  const token = newToken();
  // A new link replaces any unused one of the same kind.
  db.prepare("UPDATE account_links SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL").run(now.toISOString(), userId, purpose);
  db.prepare("INSERT INTO account_links (token_hash, user_id, purpose, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    tokenHash(token), userId, purpose, actor, now.toISOString(), new Date(now.getTime() + LINK_TTL_MS[purpose]).toISOString(),
  );
  return token;
}

/** Creates an account without a password; returns the one-time invite token. */
export function inviteUser(db: DB, input: { email: string; name: string; role: Role }, actor: string, now = new Date()): { user: UserRow; token: string } {
  const email = cleanEmail(input.email);
  const name = cleanName(input.name);
  if (!ROLES.includes(input.role)) throw new AccountError("unknown role");
  if (userByEmail(db, email)) throw new AccountError("an account with this email already exists");
  if (db.prepare("SELECT 1 FROM users WHERE name = ?").get(name)) throw new AccountError("another account already uses this name");
  return db.transaction(() => {
    const info = db
      .prepare("INSERT INTO users (email, name, role, created_at, created_by) VALUES (?, ?, ?, ?, ?)")
      .run(email, name, input.role, now.toISOString(), actor);
    const user = getUser(db, Number(info.lastInsertRowid))!;
    const token = createLink(db, user.id, "invite", actor, now);
    audit(db, actor, "user_invited", "user", user.id, { email, name, role: input.role });
    return { user, token };
  })();
}

/** A new link for an existing account: "invite" if it never set a password, else "reset". Ends its sessions. */
export function newPasswordLink(db: DB, userId: number, actor: string, now = new Date()): { purpose: "invite" | "reset"; token: string } {
  const u = getUser(db, userId);
  if (!u) throw new AccountError("no such account");
  if (u.disabled_at) throw new AccountError("enable the account first");
  const purpose: "invite" | "reset" = u.password_hash ? "reset" : "invite";
  return db.transaction(() => {
    const token = createLink(db, u.id, purpose, actor, now);
    if (purpose === "reset") db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
    audit(db, actor, purpose === "reset" ? "password_reset_link" : "invite_link_renewed", "user", u.id, { email: u.email });
    return { purpose, token };
  })();
}

export function setRole(db: DB, userId: number, role: Role, actor: string) {
  const u = getUser(db, userId);
  if (!u) throw new AccountError("no such account");
  if (!ROLES.includes(role)) throw new AccountError("unknown role");
  if (u.role === "admin" && role !== "admin" && !u.disabled_at && activeAdmins(db) <= 1) throw new AccountError("keep at least one active admin");
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, u.id);
  audit(db, actor, "user_role_changed", "user", u.id, { email: u.email, from: u.role, to: role });
}

export function setDisabled(db: DB, userId: number, disabled: boolean, actor: string, now = new Date()) {
  const u = getUser(db, userId);
  if (!u) throw new AccountError("no such account");
  if (disabled && u.role === "admin" && !u.disabled_at && activeAdmins(db) <= 1) throw new AccountError("keep at least one active admin");
  db.transaction(() => {
    db.prepare("UPDATE users SET disabled_at = ?, failed_logins = 0, locked_until = NULL WHERE id = ?").run(disabled ? now.toISOString() : null, u.id);
    if (disabled) {
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
      db.prepare("UPDATE account_links SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(now.toISOString(), u.id);
    }
    audit(db, actor, disabled ? "user_disabled" : "user_enabled", "user", u.id, { email: u.email });
  })();
}

export function revokeSessions(db: DB, userId: number, actor: string, exceptTokenHash?: string): number {
  const res = exceptTokenHash
    ? db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(userId, exceptTokenHash)
    : db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  audit(db, actor, "sessions_revoked", "user", userId, { count: res.changes });
  return res.changes;
}

// ---------------------------------------------------------------- links

export interface LinkInfo {
  purpose: "invite" | "reset";
  user: PublicUser;
}

function liveLink(db: DB, token: string, now: Date) {
  const row = db.prepare("SELECT * FROM account_links WHERE token_hash = ?").get(tokenHash(token)) as
    | { token_hash: string; user_id: number; purpose: "invite" | "reset"; expires_at: string; used_at: string | null }
    | undefined;
  if (!row || row.used_at || Date.parse(row.expires_at) <= now.getTime()) return null;
  const user = getUser(db, row.user_id);
  if (!user || user.disabled_at) return null;
  return { row, user };
}

export function checkLink(db: DB, token: string, now = new Date()): LinkInfo | null {
  const l = liveLink(db, token, now);
  return l ? { purpose: l.row.purpose, user: toPublic(l.user) } : null;
}

/** Uses an invite or reset link to set the password. The link works once. */
export function setPasswordWithLink(db: DB, token: string, password: string, now = new Date()): PublicUser {
  const l = liveLink(db, token, now);
  if (!l) throw new AccountError("this link is invalid, used or expired; ask an admin for a new one");
  const problem = passwordProblem(password, l.user);
  if (problem) throw new AccountError(problem);
  const hash = hashPassword(password);
  db.transaction(() => {
    db.prepare("UPDATE account_links SET used_at = ? WHERE token_hash = ?").run(now.toISOString(), l.row.token_hash);
    db.prepare("UPDATE users SET password_hash = ?, password_changed_at = ?, failed_logins = 0, locked_until = NULL WHERE id = ?").run(hash, now.toISOString(), l.user.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(l.user.id);
    audit(db, l.user.name, l.row.purpose === "invite" ? "invite_accepted" : "password_reset", "user", l.user.id);
  })();
  return toPublic(l.user);
}

export function changePassword(db: DB, userId: number, current: string, next: string, keepTokenHash: string, now = new Date()) {
  const u = getUser(db, userId);
  if (!u?.password_hash || !verifyPassword(current, u.password_hash)) throw new AccountError("your current password is wrong");
  const problem = passwordProblem(next, u);
  if (problem) throw new AccountError(problem);
  if (verifyPassword(next, u.password_hash)) throw new AccountError("choose a different password");
  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?").run(hashPassword(next), now.toISOString(), u.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(u.id, keepTokenHash); // sign out other devices
    audit(db, u.name, "password_changed", "user", u.id);
  })();
}

// ---------------------------------------------------------------- login and sessions

export type LoginResult = { ok: true; user: PublicUser; token: string } | { ok: false; status: 401 | 429; error: string };

const GENERIC = "email or password is wrong";

/** Counts an attempt for an address; false when the address is over its limit. */
function throttle(db: DB, ip: string, now: Date): boolean {
  const key = `ip:${ip}`;
  const row = db.prepare("SELECT * FROM login_throttle WHERE key = ?").get(key) as { window_start: string; attempts: number } | undefined;
  if (!row || now.getTime() - Date.parse(row.window_start) > IP_WINDOW_MS) {
    db.prepare("INSERT INTO login_throttle (key, window_start, attempts) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, attempts = 1").run(key, now.toISOString());
    return true;
  }
  db.prepare("UPDATE login_throttle SET attempts = attempts + 1 WHERE key = ?").run(key);
  return row.attempts + 1 <= IP_MAX_ATTEMPTS;
}

export function login(db: DB, emailInput: string, password: string, meta: { ip: string; userAgent: string }, now = new Date()): LoginResult {
  if (!throttle(db, meta.ip, now)) {
    audit(db, "anonymous", "login_throttled", "ip", meta.ip);
    return { ok: false, status: 429, error: "too many sign-in attempts from this address; wait 15 minutes" };
  }
  const user = userByEmail(db, emailInput);
  if (!user || !user.password_hash || user.disabled_at) {
    burnTime(password);
    audit(db, "anonymous", "login_failed", "user", user?.id ?? null, { email: emailInput.slice(0, 254), reason: !user ? "unknown email" : user.disabled_at ? "disabled" : "no password set" });
    return { ok: false, status: 401, error: GENERIC };
  }
  if (user.locked_until && Date.parse(user.locked_until) > now.getTime()) {
    burnTime(password);
    audit(db, "anonymous", "login_failed", "user", user.id, { reason: "locked" });
    return { ok: false, status: 429, error: "this account is locked after repeated wrong passwords; try again in 15 minutes or ask an admin for a reset link" };
  }
  if (!verifyPassword(password, user.password_hash)) {
    const failed = user.failed_logins + 1;
    const lock = failed >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MS).toISOString() : null;
    db.prepare("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?").run(lock ? 0 : failed, lock, user.id);
    audit(db, "anonymous", lock ? "account_locked" : "login_failed", "user", user.id, { reason: "wrong password" });
    return { ok: false, status: 401, error: GENERIC };
  }
  const token = newToken();
  db.transaction(() => {
    db.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?").run(now.toISOString(), user.id);
    db.prepare("DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?").run(now.toISOString(), new Date(now.getTime() - SESSION_IDLE_MS).toISOString());
    db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      tokenHash(token), user.id, now.toISOString(), now.toISOString(), new Date(now.getTime() + SESSION_MAX_MS).toISOString(), meta.ip.slice(0, 64), meta.userAgent.slice(0, 200),
    );
    audit(db, user.name, "login", "user", user.id);
  })();
  return { ok: true, user: toPublic(user), token };
}

/** The signed-in user for a session token, or null. Extends the idle window (at most once a minute). */
export function sessionUser(db: DB, token: string | undefined, now = new Date()): (PublicUser & { tokenHash: string }) | null {
  if (!token || token.length > 100) return null;
  const h = tokenHash(token);
  const row = db
    .prepare("SELECT s.last_seen_at, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?")
    .get(h) as (UserRow & { last_seen_at: string; expires_at: string }) | undefined;
  if (!row) return null;
  const t = now.getTime();
  if (row.disabled_at || Date.parse(row.expires_at) <= t || Date.parse(row.last_seen_at) + SESSION_IDLE_MS <= t) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(h);
    return null;
  }
  if (t - Date.parse(row.last_seen_at) > 60_000) db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(now.toISOString(), h);
  return { ...toPublic(row), tokenHash: h };
}

export function logout(db: DB, token: string | undefined) {
  if (!token) return;
  const u = sessionUser(db, token);
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
  if (u) audit(db, u.name, "logout", "user", u.id);
}

