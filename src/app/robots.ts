import type { MetadataRoute } from "next";

/** Public dashboards may be indexed; the review area and APIs may not. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/review", "/api/"] }] };
}
