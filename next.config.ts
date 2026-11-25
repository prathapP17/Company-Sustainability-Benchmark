import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Content Security Policy without nonces, so public pages stay pre-built
 * (nonces force per-request rendering). Everything loads from this origin;
 * inline scripts are Next.js's own bootstrap. HTTPS redirects and HSTS are
 * set by the Caddy proxy in hosted mode.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The review area and its API are never cached by browsers or proxies.
      { source: "/review/:path*", headers: [{ key: "Cache-Control", value: "no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/api/pipeline/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
  cacheComponents: true,
  // pdfkit reads its font metrics from disk; keep these as plain Node requires.
  serverExternalPackages: ["pdfkit", "exceljs", "tesseract.js", "@napi-rs/canvas", "@tesseract.js-data/eng"],
  partialPrefetching: true,
  turbopack: {
    // Pin the project root so a stray lockfile in a parent folder is never picked up.
    root: import.meta.dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
