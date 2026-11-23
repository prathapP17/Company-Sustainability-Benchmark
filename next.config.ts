import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // pdfkit reads its font metrics from disk; keep these as plain Node requires.
  serverExternalPackages: ["pdfkit", "exceljs"],
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
