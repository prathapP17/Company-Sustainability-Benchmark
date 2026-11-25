"use client";

/**
 * Interactive headquarters map. Markers show the DISCLOSURE STATUS of the
 * selected metric (shape + colour + text), never the size of the value: two
 * markers side by side do not make two companies comparable. Values appear in
 * the selected-company panel and the list, each with its fiscal year,
 * boundary and source.
 *
 * Accessible alternative: the list below the map holds every filtered company
 * (and every company that cannot be placed), and works without the map.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import Link from "next/link";
import type { MapCell, MapCompany, MapMetric } from "@/lib/map/data";
import type { MapGeometry } from "@/lib/map/geo";
import { LABELS } from "@/lib/labels";
import type { Boundary, DisclosureState } from "@/lib/schema/enums";
import { CoverageBar } from "../CoverageBar";
import { Tag } from "../ui";

type Status = DisclosureState | "not_applicable";
interface View {
  k: number;
  x: number;
  y: number;
}

const MAX_ZOOM = 8;
const CLUSTER_PX = 26;
const PANEL_METRICS = ["ghg_scope1", "ghg_scope2_market", "ghg_scope2_location", "ghg_scope3_total", "energy_total", "renewable_electricity_share", "water_withdrawal", "waste_total"];

const STATUS_TEXT: Record<Status, string> = { ...LABELS.state, not_applicable: "Does not apply" };

function statusOf(c: MapCompany, metric: string): Status {
  return c.cells[metric]?.state ?? "not_applicable";
}

/** Marker look per status. Shapes differ so status never depends on colour alone. */
function Marker({ status, flagged, selected }: { status: Status; flagged: boolean; selected: boolean }) {
  const ring = selected ? "outline outline-[3px] outline-offset-2 outline-[var(--accent)]" : "";
  const base = "block size-3.5 border-2 border-[var(--surface)] shadow-[0_0_0_1px_var(--ink-2)]";
  if (status === "disclosed" && flagged) return <span aria-hidden className={`${base} ${ring} rotate-45 rounded-[2px] bg-[var(--state-disclosed)]`} />;
  if (status === "disclosed") return <span aria-hidden className={`${base} ${ring} rounded-full bg-[var(--state-disclosed)]`} />;
  if (status === "not_disclosed") return <span aria-hidden className={`${ring} block size-3.5 rounded-full border-[3px] border-[var(--state-not-disclosed)] bg-[var(--surface)]`} />;
  if (status === "not_found") return <span aria-hidden className={`${ring} block size-3.5 rounded-full border-2 border-dashed border-[var(--ink-2)] bg-[var(--surface)]`} />;
  if (status === "not_assessed") return <span aria-hidden className={`${ring} texture-not-assessed block size-3.5 rounded-[3px] border border-[var(--ink-2)]`} />;
  return <span aria-hidden className={`${ring} block size-2.5 rounded-full bg-[var(--ink-muted)]`} />;
}

export function MapLegend() {
  const items: [Status, boolean, string][] = [
    ["disclosed", false, "Disclosed"],
    ["disclosed", true, "Disclosed, not usable across companies (boundary, coverage or source)"],
    ["not_disclosed", false, "Not disclosed"],
    ["not_found", false, "Not found"],
    ["not_assessed", false, "Not assessed"],
    ["not_applicable", false, "Metric does not apply to its industry"],
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2" aria-label="Map legend">
      {items.map(([s, f, label]) => (
        <li key={label} className="inline-flex items-center gap-1.5">
          <Marker status={s} flagged={f} selected={false} />
          {label}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-flex size-5 items-center justify-center rounded-full border-2 border-[var(--accent)] bg-[var(--surface)] text-[10px] font-semibold text-ink">
          3
        </span>
        Nearby companies grouped (select to zoom)
      </li>
    </ul>
  );
}

function CellLine({ cell }: { cell: MapCell | undefined }) {
  if (!cell) return <span className="text-ink-muted">Does not apply</span>;
  if (cell.state !== "disclosed") {
    return (
      <span className="text-ink-2">
        {LABELS.state[cell.state]}
        {cell.fyLabel && <span className="text-ink-muted"> · {cell.fyLabel}</span>}
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-0.5">
      <span className="tabular text-ink">
        {cell.display} <span className="text-xs text-ink-muted">· {cell.fyLabel}</span>
      </span>
      {(cell.boundary !== "consolidated_group" || cell.coverage || cell.derived || cell.lowConfidence) && (
        <span className="flex flex-wrap gap-1">
          {cell.boundary && cell.boundary !== "consolidated_group" && <Tag tone="warn">Boundary: {LABELS.boundary[cell.boundary as Boundary].toLowerCase()}</Tag>}
          {cell.coverage && <Tag tone="warn">{cell.coverage}</Tag>}
          {cell.derived && <Tag>Derived</Tag>}
          {cell.lowConfidence && <Tag tone="warn">Low confidence</Tag>}
        </span>
      )}
      {cell.sourceUrl ? (
        <a href={cell.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-accent">
          {cell.sourceTitle ?? "Source"}
          {cell.page ? `, ${cell.page}` : ""}
        </a>
      ) : (
        cell.sourceTitle && (
          <span className="text-xs text-ink-muted">
            {cell.sourceTitle}
            {cell.page ? `, ${cell.page}` : ""}
          </span>
        )
      )}
    </span>
  );
}

function CompanyPanel({ c, metrics, metricId, onClose }: { c: MapCompany; metrics: MapMetric[]; metricId: string; onClose: () => void }) {
  const label = new Map(metrics.map((m) => [m.id, m.label]));
  const industryKpis = c.applicable.filter((id) => metrics.find((m) => m.id === id)?.group === "Industry-specific");
  const shown = [...new Set([metricId, ...PANEL_METRICS])].filter((id) => c.cells[id] || id === metricId);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-ink">{c.name}</h3>
          <p className="text-sm text-ink-2">
            {c.city}, {c.country} · {c.region}
          </p>
        </div>
        <button type="button" onClick={onClose} className="btn-ghost" aria-label={`Close ${c.name} details`}>
          ✕
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-ink-muted">Industry (GICS)</dt>
        <dd className="text-ink-2">{c.gics}</dd>
        <dt className="text-ink-muted">SASB</dt>
        <dd className="text-ink-2">
          {c.industries.map((i) => i.label).join("; ") || c.sasb}
          {c.classificationReview && (
            <div className="mt-1">
              <Tag tone="warn" title={c.classificationReview}>
                Classification needs review
              </Tag>
            </div>
          )}
        </dd>
        <dt className="text-ink-muted">Peer group</dt>
        <dd>
          <Link href={`/peers/${c.peerGroupId}`} className="text-accent">
            {c.peerGroupName}
          </Link>
        </dd>
        <dt className="text-ink-muted">Listing</dt>
        <dd className="text-ink-2">{c.listings.map((l) => `${l.exchange}: ${l.ticker}`).join(", ")}</dd>
        <dt className="text-ink-muted">Latest year</dt>
        <dd className="text-ink-2">{c.latestYearLabel ?? "No disclosed year"}</dd>
        <dt className="text-ink-muted">Research</dt>
        <dd className="text-ink-2">
          {c.researchStatus === "detailed" ? "Detailed" : c.researchStatus === "partial" ? "Partial" : "Profile only (no metrics researched yet)"} · reviewed {c.lastReviewed}
        </dd>
      </dl>
      <div>
        <div className="mb-1 flex justify-between text-xs text-ink-muted">
          <span>Core-metric coverage</span>
          <span className="tabular">
            {c.coverage.disclosed}/{c.coverage.total} disclosed
          </span>
        </div>
        <CoverageBar
          label={`${c.name} coverage`}
          total={c.coverage.total}
          counts={{ disclosed: c.coverage.disclosed, not_disclosed: c.coverage.notDisclosed, not_found: c.coverage.notFound, not_assessed: c.coverage.notAssessed }}
        />
      </div>
      <div>
        <h4 className="mb-2 text-sm font-medium text-ink">Latest values</h4>
        <ul className="flex flex-col gap-2 text-sm">
          {shown.map((id) => (
            <li key={id} className={`grid grid-cols-[minmax(0,9rem)_1fr] gap-2 ${id === metricId ? "rounded bg-[var(--hairline)]/40 px-1 py-0.5" : ""}`}>
              <span className="text-ink-muted">{label.get(id)}</span>
              <CellLine cell={c.cells[id]} />
            </li>
          ))}
        </ul>
      </div>
      {industryKpis.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-ink">Industry KPIs</h4>
          <ul className="flex flex-col gap-2 text-sm">
            {industryKpis.map((id) => (
              <li key={id} className="grid grid-cols-[minmax(0,9rem)_1fr] gap-2">
                <span className="text-ink-muted">{label.get(id)}</span>
                <CellLine cell={c.cells[id]} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <Link href={`/companies/${c.id}`} className="btn-primary self-start">
        Open company profile
      </Link>
    </div>
  );
}

export function MapExplorer({
  geometry,
  baseMapUrl,
  companies,
  metrics,
}: {
  geometry: MapGeometry;
  baseMapUrl: string;
  companies: MapCompany[];
  metrics: MapMetric[];
}) {
  const W = geometry.width;
  const H = geometry.height;
  const [metric, setMetric] = useState("ghg_scope1");
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [group, setGroup] = useState("");
  const [industry, setIndustry] = useState("");
  const [status, setStatus] = useState<"" | Status>("");
  const [period, setPeriod] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [cw, setCw] = useState(1000);
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCw(e.contentRect.width || 1000));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const regions = useMemo(() => [...new Set(companies.map((c) => c.region))].sort(), [companies]);
  const groups = useMemo(() => [...new Map(companies.map((c) => [c.peerGroupId, c.peerGroupName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [companies]);
  const industries = useMemo(() => [...new Map(companies.flatMap((c) => c.industries.map((i) => [i.code, i.label]))).entries()].sort((a, b) => a[1].localeCompare(b[1])), [companies]);
  const periods = useMemo(
    () => [...new Set(companies.map((c) => c.cells[metric]?.periodYear).filter((y): y is number => typeof y === "number"))].sort((a, b) => b - a),
    [companies, metric],
  );
  const metricDef = metrics.find((m) => m.id === metric)!;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return companies.filter((c) => {
      if (needle && ![c.name, c.city, c.country, ...c.listings.map((l) => l.ticker)].some((s) => s.toLowerCase().includes(needle))) return false;
      if (region && c.region !== region) return false;
      if (group && c.peerGroupId !== group) return false;
      if (industry && !c.industries.some((i) => i.code === industry)) return false;
      if (status && statusOf(c, metric) !== status) return false;
      if (period && c.cells[metric]?.periodYear !== Number(period)) return false;
      return true;
    });
  }, [companies, q, region, group, industry, status, period, metric]);

  // Screen-space clustering at the current zoom.
  const unit = W / Math.max(cw, 1); // map units per CSS pixel at k = 1
  const clusters = useMemo(() => {
    const placed = filtered.filter((c) => c.pos).map((c) => ({ c, sx: c.pos!.x * view.k + view.x, sy: c.pos!.y * view.k + view.y }));
    const out: { members: MapCompany[]; sx: number; sy: number }[] = [];
    for (const p of placed) {
      const hit = out.find((cl) => Math.hypot(cl.sx - p.sx, cl.sy - p.sy) < CLUSTER_PX * unit);
      if (hit) {
        hit.members.push(p.c);
        hit.sx = (hit.sx * (hit.members.length - 1) + p.sx) / hit.members.length;
        hit.sy = (hit.sy * (hit.members.length - 1) + p.sy) / hit.members.length;
      } else out.push({ members: [p.c], sx: p.sx, sy: p.sy });
    }
    return out.filter((cl) => cl.sx >= -5 && cl.sx <= W + 5 && cl.sy >= -5 && cl.sy <= H + 5);
  }, [filtered, view, unit, W, H]);

  const clamp = (v: View): View => {
    const k = Math.min(MAX_ZOOM, Math.max(1, v.k));
    return { k, x: Math.min(0, Math.max(W - W * k, v.x)), y: Math.min(0, Math.max(H - H * k, v.y)) };
  };
  const zoomAt = (factor: number, cx = W / 2, cy = H / 2) =>
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(1, v.k * factor));
      return clamp({ k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k });
    });
  const zoomTo = (members: MapCompany[]) => {
    const xs = members.map((m) => m.pos!.x);
    const ys = members.map((m) => m.pos!.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.min(MAX_ZOOM, Math.max(view.k * 2, Math.min(W / Math.max(x1 - x0, 1), H / Math.max(y1 - y0, 1)) * 0.35));
    setView(clamp({ k, x: W / 2 - ((x0 + x1) / 2) * k, y: H / 2 - ((y0 + y1) / 2) * k }));
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button,a")) return;
    drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y, moved: false };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.px) * unit;
    const dy = (e.clientY - d.py) * unit;
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
    setView((v) => clamp({ ...v, x: d.x + dx, y: d.y + dy }));
  };
  const onPointerUp = () => {
    drag.current = null;
    setDragging(false);
  };
  const onWheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return; // plain scrolling scrolls the page
    e.preventDefault();
    const r = box.current!.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.25 : 0.8, ((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const step = 40;
    const map: Record<string, () => void> = {
      "+": () => zoomAt(1.5),
      "=": () => zoomAt(1.5),
      "-": () => zoomAt(1 / 1.5),
      "0": () => setView({ k: 1, x: 0, y: 0 }),
      ArrowLeft: () => setView((v) => clamp({ ...v, x: v.x + step })),
      ArrowRight: () => setView((v) => clamp({ ...v, x: v.x - step })),
      ArrowUp: () => setView((v) => clamp({ ...v, y: v.y + step })),
      ArrowDown: () => setView((v) => clamp({ ...v, y: v.y - step })),
    };
    if (map[e.key]) {
      e.preventDefault();
      map[e.key]();
    }
  };

  const sel = companies.find((c) => c.id === selected) ?? null;
  const unplaced = filtered.filter((c) => !c.pos);
  const reset = () => {
    setQ("");
    setRegion("");
    setGroup("");
    setIndustry("");
    setStatus("");
    setPeriod("");
  };
  const anyFilter = q || region || group || industry || status || period;
  const describe = (c: MapCompany) => {
    const cell = c.cells[metric];
    const st = STATUS_TEXT[statusOf(c, metric)];
    return `${c.name}, ${c.city}, ${c.country}. ${metricDef.label}: ${cell?.state === "disclosed" ? `${cell.display}, ${cell.fyLabel}` : st}`;
  };
  const hovered = hover ? clusters.find((cl) => cl.members.length === 1 && cl.members[0].id === hover) : undefined;
  const byRegion = regions.map((r) => [r, filtered.filter((c) => c.region === r)] as const).filter(([, l]) => l.length);

  return (
    <div className="flex flex-col gap-4">
      <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => e.preventDefault()} aria-label="Map filters">
        <label className="field lg:col-span-2">
          <span>Metric shown on the map</span>
          <select value={metric} onChange={(e) => {
              setMetric(e.target.value);
              setPeriod("");
            }}>
            {(["Core", "More", "Industry-specific"] as const).map((g) => (
              <optgroup key={g} label={g === "Industry-specific" ? "Industry-specific (only some industries)" : g === "Core" ? "Core metrics" : "More metrics"}>
                {metrics
                  .filter((m) => m.group === g)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field lg:col-span-2">
          <span>Search the map</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, city, country or ticker" />
        </label>
        <label className="field">
          <span>Region</span>
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All regions</option>
            {regions.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Industry (SASB)</span>
          <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
            <option value="">All industries</option>
            {industries.map(([code, l]) => (
              <option key={code} value={code}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Peer group</span>
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">All groups</option>
            {groups.map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span>Disclosure</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as Status | "")}>
              <option value="">Any</option>
              {(Object.keys(STATUS_TEXT) as Status[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_TEXT[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Period ends</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="">Any year</option>
              {periods.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <p aria-live="polite">
          {filtered.length} of {companies.length} companies shown
          {anyFilter && (
            <>
              {" · "}
              <button type="button" className="text-accent underline" onClick={reset}>
                Clear filters
              </button>
            </>
          )}
        </p>
        <p>
          {metricDef.label} ({metricDef.unit}){metricDef.appliesTo !== "all" ? ` · applies to ${metricDef.appliesTo.join(", ")} only` : ""}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <div
            ref={box}
            role="application"
            aria-roledescription="map"
            aria-label={`Map of company headquarters. ${clusters.length} markers. Plus and minus keys zoom, arrow keys pan, 0 resets. The list below holds the same companies.`}
            tabIndex={0}
            onKeyDown={onKey}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            onDoubleClick={(e) => {
              if ((e.target as HTMLElement).closest("button,a")) return;
              const r = box.current!.getBoundingClientRect();
              zoomAt(2, ((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
            }}
            className="relative touch-none select-none overflow-hidden rounded-lg border border-hairline bg-[var(--map-sea)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            style={{ aspectRatio: `${W} / ${H}`, cursor: dragging ? "grabbing" : "grab" }}
          >
            <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full" aria-hidden focusable="false">
              <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                <use href={`${baseMapUrl}#land`} style={{ fill: "var(--map-land)" }} />
                {geometry.hqCountries.map((c) => (
                  <path key={c.name} d={c.d} style={{ fill: "var(--map-hq)" }} />
                ))}
                <use href={`${baseMapUrl}#borders`} style={{ fill: "none", stroke: "var(--map-border)", strokeWidth: 0.6 / view.k }} />
              </g>
            </svg>
            {clusters.map((cl) => {
              const left = `${(cl.sx / W) * 100}%`;
              const top = `${(cl.sy / H) * 100}%`;
              if (cl.members.length > 1) {
                const names = cl.members.map((m) => m.name).join(", ");
                return (
                  <button
                    key={cl.members.map((m) => m.id).join("+")}
                    type="button"
                    className="absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[var(--accent)] bg-[var(--surface)] text-xs font-semibold text-ink shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    style={{ left, top }}
                    aria-label={`${cl.members.length} companies here: ${names}. Zoom in`}
                    title={names}
                    onClick={() => (view.k >= MAX_ZOOM ? setSelected(cl.members[0].id) : zoomTo(cl.members))}
                  >
                    {cl.members.length}
                  </button>
                );
              }
              const c = cl.members[0];
              const st = statusOf(c, metric);
              const flagged = st === "disclosed" && (c.cells[metric]?.issues.length ?? 0) > 0;
              return (
                <button
                  key={c.id}
                  type="button"
                  className="absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                  style={{ left, top }}
                  aria-label={describe(c)}
                  aria-pressed={selected === c.id}
                  onClick={() => setSelected(c.id)}
                  onMouseEnter={() => setHover(c.id)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(c.id)}
                  onBlur={() => setHover(null)}
                >
                  <Marker status={st} flagged={flagged} selected={selected === c.id} />
                </button>
              );
            })}
            {hovered && (
              <div
                role="presentation"
                className="pointer-events-none absolute z-10 max-w-56 -translate-x-1/2 rounded-md border border-hairline bg-surface px-2 py-1 text-xs shadow"
                style={{ left: `${(hovered.sx / W) * 100}%`, top: `calc(${(hovered.sy / H) * 100}% + 14px)` }}
              >
                <div className="font-medium text-ink">{hovered.members[0].name}</div>
                <div className="text-ink-2">
                  {(() => {
                    const cell = hovered.members[0].cells[metric];
                    return cell?.state === "disclosed" ? `${cell.display} · ${cell.fyLabel}` : STATUS_TEXT[statusOf(hovered.members[0], metric)];
                  })()}
                </div>
              </div>
            )}
            <div className="absolute right-2 top-2 flex flex-col gap-1">
              <button type="button" className="map-btn" aria-label="Zoom in" onClick={() => zoomAt(1.5)}>
                +
              </button>
              <button type="button" className="map-btn" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.5)}>
                −
              </button>
              <button type="button" className="map-btn text-[10px]" aria-label="Reset map view" onClick={() => setView({ k: 1, x: 0, y: 0 })}>
                ⟲
              </button>
            </div>
          </div>
          <p className="text-[11px] text-ink-muted">
            Drag to pan; double-click, ⌘/Ctrl + scroll or the buttons to zoom. Map: Natural Earth (public domain), Equal
            Earth projection. Headquarters positions are approximate city centres from the company files.
          </p>
          <MapLegend />
          <p className="text-xs text-ink-muted">
            Markers show whether the selected metric is disclosed, not how large it is. Being on one map does not make
            companies comparable: industries, fiscal years and boundaries differ. Use{" "}
            <Link href="/compare" className="text-accent">
              Compare
            </Link>{" "}
            or{" "}
            <Link href="/peers" className="text-accent">
              Peer benchmarks
            </Link>{" "}
            for checked comparisons.
          </p>
        </div>

        <aside aria-label="Selected company" className="rounded-lg border border-hairline bg-surface p-4">
          {sel ? (
            <CompanyPanel c={sel} metrics={metrics} metricId={metric} onClose={() => setSelected(null)} />
          ) : (
            <div className="flex h-full flex-col justify-center gap-2 text-sm text-ink-2">
              <p className="font-medium text-ink">No company selected</p>
              <p>Select a marker or a company in the list to see its headquarters, industry, coverage and latest values with sources.</p>
            </div>
          )}
        </aside>
      </div>

      <section aria-labelledby="loc-list" className="rounded-lg border border-hairline bg-surface p-4">
        <h3 id="loc-list" className="mb-3 text-sm font-semibold text-ink">
          Companies by location <span className="font-normal text-ink-muted">· {metricDef.label}</span>
        </h3>
        {filtered.length === 0 ? (
          <p className="text-sm text-ink-muted">No company matches these filters.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {byRegion.map(([r, list]) => (
              <div key={r}>
                <h4 className="text-xs font-medium uppercase tracking-wide text-ink-muted">{r}</h4>
                <ul className="mt-1.5 flex flex-col gap-1.5 text-sm">
                  {list.map((c) => {
                    const cell = c.cells[metric];
                    return (
                      <li key={c.id} className="flex items-start justify-between gap-2">
                        <button type="button" className={`text-left text-accent underline-offset-2 hover:underline ${selected === c.id ? "font-semibold" : ""}`} aria-pressed={selected === c.id} onClick={() => setSelected(c.id)}>
                          {c.name}
                          <span className="block text-xs font-normal text-ink-muted">
                            {c.city}, {c.country}
                          </span>
                        </button>
                        <span className="tabular shrink-0 text-right text-xs text-ink-2">
                          {cell?.state === "disclosed" ? (
                            <>
                              {cell.display}
                              <span className="block text-ink-muted">{cell.fyLabel}</span>
                            </>
                          ) : (
                            STATUS_TEXT[statusOf(c, metric)]
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        {unplaced.length > 0 && (
          <div className="mt-4 border-t border-hairline pt-3">
            <h4 className="text-xs font-medium text-ink">Not on the map</h4>
            <ul className="mt-1 text-sm text-ink-2">
              {unplaced.map((c) => (
                <li key={c.id}>
                  {c.name}: {c.unplacedReason} (location not guessed)
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
