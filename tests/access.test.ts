import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAccess, checkSameOrigin, checkToken, cleanReviewerName, isLocal, makeCookieValue, pipelineEnabled, readCookieValue } from "@/lib/pipeline/access";

const H = (h: Record<string, string>) => new Headers(h);

beforeEach(() => {
  process.env.REVIEWER_TOKEN = "test-token-0123456789";
});
afterEach(() => {
  delete process.env.REVIEWER_TOKEN;
});

describe("pipeline access (local-only + reviewer token)", () => {
  it("is disabled without a long enough token", () => {
    process.env.REVIEWER_TOKEN = "short";
    expect(pipelineEnabled()).toBe(false);
    expect(checkAccess(H({ host: "localhost:3000" }), undefined)).toMatchObject({ ok: false, status: 404 });
  });

  it("accepts only localhost requests without proxy or tunnel headers", () => {
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
  });

  it("signs the reviewer cookie and rejects tampering", () => {
    const v = makeCookieValue("Alex");
    expect(readCookieValue(v)).toBe("Alex");
    const [, sig] = v.split(".");
    expect(readCookieValue(`${Buffer.from("Mallory").toString("base64url")}.${sig}`)).toBeNull();
    process.env.REVIEWER_TOKEN = "a-different-token-xyz";
    expect(readCookieValue(v)).toBeNull(); // rotating the token signs everyone out
  });

  it("grants access only with a valid cookie on a local request", () => {
    expect(checkAccess(H({ host: "localhost:3000" }), undefined)).toMatchObject({ ok: false, status: 401 });
    expect(checkAccess(H({ host: "localhost:3000" }), makeCookieValue("Alex"))).toEqual({ ok: true, reviewer: "Alex" });
    expect(checkAccess(H({ host: "evil.example" }), makeCookieValue("Alex"))).toMatchObject({ ok: false, status: 403 });
  });

  it("compares the token in constant time and checks same origin", () => {
    expect(checkToken("test-token-0123456789")).toBe(true);
    expect(checkToken("test-token-012345678")).toBe(false);
    expect(checkSameOrigin(H({ host: "localhost:3000", origin: "http://localhost:3000" }))).toBe(true);
    expect(checkSameOrigin(H({ host: "localhost:3000", origin: "http://evil.example" }))).toBe(false);
    expect(checkSameOrigin(H({ host: "localhost:3000" }))).toBe(false);
  });

  it("sanitises reviewer names for the audit trail", () => {
    expect(cleanReviewerName("  Ana <script>  ")).toBe("Ana script");
  });
});
