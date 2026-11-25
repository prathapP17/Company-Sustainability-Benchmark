/**
 * Minimal fetch over node:https for slow-handshake hosts. Node's built-in
 * fetch aborts when connect + TLS takes over 10 seconds, and GDELT's TLS
 * handshake regularly takes about 11 (measured 2026-11-25). Redirects are not
 * followed (PoliteHttp follows them itself, checking robots.txt per hop).
 */
import https from "node:https";
import http from "node:http";
import type { FetchLike } from "../discovery/http";

export const nodeFetch: FetchLike = (url, init = {}) =>
  new Promise<Response>((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : u.protocol === "http:" ? http : null;
    if (!lib) return reject(new Error(`unsupported scheme ${u.protocol}`));
    const headers: Record<string, string> = {};
    new Headers(init.headers as HeadersInit | undefined).forEach((v, k) => (headers[k] = v));
    const req = lib.request(u, { method: init.method ?? "GET", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(", ") : String(v));
        const status = res.statusCode ?? 0;
        const noBody = init.method === "HEAD" || status === 204 || status === 304;
        resolve(new Response(noBody ? null : Buffer.concat(chunks), { status, headers: h }));
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    const signal = init.signal as AbortSignal | undefined;
    if (signal) {
      if (signal.aborted) req.destroy(Object.assign(new Error("aborted"), { name: "AbortError" }));
      signal.addEventListener("abort", () => req.destroy(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }
    req.end();
  });
