import { baseMapSvg } from "@/lib/map/geo";

/** Static base map for the dashboard (built once; same-origin, no third-party tiles). */
export function GET() {
  return new Response(baseMapSvg(), {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}
