"use client";

/**
 * Site header: grouped navigation (accessible disclosure menus on desktop, one
 * expandable panel on small screens), company search and the theme switch.
 * The review area is listed under Administration; every page there checks the
 * visitor's role itself, so listing it here exposes nothing.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export interface SearchItem {
  id: string;
  name: string;
  hint: string;
}

type Item = { href: string; label: string; note?: string };
const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Explore",
    items: [
      { href: "/companies", label: "Companies", note: "All companies, coverage and research status" },
      { href: "/compare", label: "Compare", note: "Pick companies and metrics side by side" },
      { href: "/peers", label: "Peer benchmarks", note: "Per SASB industry, with checked medians" },
      { href: "/industry", label: "Industry KPIs", note: "SASB industry-specific indicators" },
    ],
  },
  {
    label: "Performance",
    items: [
      { href: "/targets", label: "Targets", note: "Targets, progress and SBTi pace check" },
      { href: "/scope3", label: "Scope 3", note: "Category heatmap" },
      { href: "/rankings", label: "Rankings", note: "Transparency and performance scores" },
    ],
  },
  {
    label: "Transparency",
    items: [
      { href: "/transparency", label: "Disclosure checklist" },
      { href: "/methodology", label: "Methodology" },
      { href: "/downloads", label: "Downloads", note: "Exports for signed-in accounts" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/review", label: "Review queue", note: "Reviewers" },
      { href: "/review#upload", label: "Uploads", note: "Reviewers" },
      { href: "/review/alerts", label: "Alerts", note: "Reviewers" },
      { href: "/review/users", label: "Users", note: "Admins" },
      { href: "/review/audit", label: "Audit log", note: "Admins" },
      { href: "/review/account", label: "My account" },
    ],
  },
];

const isCurrent = (path: string, href: string) => (href === "/" ? path === "/" : path === href.split("#")[0] || (href !== "/review" && path.startsWith(`${href.split("#")[0]}/`)));

function Menu({ group, path, open, onToggle, onClose }: { group: (typeof GROUPS)[number]; path: string; open: boolean; onToggle: () => void; onClose: () => void }) {
  const id = useId();
  const active = group.items.some((i) => isCurrent(path, i.href));
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm ${active ? "text-ink" : "text-ink-2"} hover:bg-[var(--hairline)] hover:text-ink`}
      >
        {group.label}
        {active && <span className="sr-only"> (current section)</span>}
        <span aria-hidden className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && (
        <ul id={id} className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-hairline bg-surface p-1 shadow-lg">
          {group.items.map((i) => (
            <li key={i.href}>
              <Link
                href={i.href}
                onClick={onClose}
                aria-current={isCurrent(path, i.href) ? "page" : undefined}
                className="block rounded-md px-3 py-2 text-sm text-ink hover:bg-[var(--hairline)] aria-[current=page]:font-semibold"
              >
                {i.label}
                {i.note && <span className="block text-xs font-normal text-ink-muted">{i.note}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CompanySearch({ items, onDone }: { items: SearchItem[]; onDone?: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const needle = q.trim().toLowerCase();
  const hits = needle ? items.filter((i) => i.name.toLowerCase().includes(needle) || i.hint.toLowerCase().includes(needle)).slice(0, 8) : [];
  const go = (i: SearchItem) => {
    setQ("");
    setOpen(false);
    onDone?.();
    router.push(`/companies/${i.id}`);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };
  return (
    <div className="relative w-full lg:w-56">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search companies
      </label>
      <input
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && hits[active] ? `${listId}-${hits[active].id}` : undefined}
        value={q}
        placeholder="Search companies"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKey}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="h-9 w-full rounded-lg border border-[var(--axis)] bg-surface px-3 text-sm text-ink placeholder:text-ink-muted"
      />
      {open && needle && (
        <ul id={listId} role="listbox" aria-label="Matching companies" className="absolute right-0 top-full z-30 mt-1 w-full min-w-56 rounded-lg border border-hairline bg-surface p-1 shadow-lg">
          {hits.length === 0 ? (
            <li role="option" aria-selected={false} aria-disabled className="px-3 py-2 text-sm text-ink-muted">
              No company matches
            </li>
          ) : (
            hits.map((i, k) => (
              <li
                key={i.id}
                id={`${listId}-${i.id}`}
                role="option"
                aria-selected={k === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(i);
                }}
                className={`cursor-pointer rounded-md px-3 py-2 text-sm ${k === active ? "bg-[var(--hairline)]" : ""}`}
              >
                <span className="text-ink">{i.name}</span>
                <span className="block text-xs text-ink-muted">{i.hint}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

type Theme = "system" | "light" | "dark";
function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem("csi-theme");
      // Reading a browser-only preference after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}
  }, []);
  const next: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const apply = (t: Theme) => {
    setTheme(t);
    try {
      if (t === "system") {
        localStorage.removeItem("csi-theme");
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem("csi-theme", t);
        document.documentElement.dataset.theme = t;
      }
    } catch {}
  };
  const label = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" }[theme];
  return (
    <button type="button" className="btn-ghost h-9 px-2 text-xs" onClick={() => apply(next[theme])} aria-label={`${label}. Change theme`} title={label}>
      <span aria-hidden>{theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐"}</span>
    </button>
  );
}

/** Reads the pathname for "current page" marks; wrapped in Suspense by the layout (unknown dynamic params suspend). */
export function SiteHeader({ search }: { search: SearchItem[] }) {
  return <SiteHeaderView search={search} path={usePathname()} />;
}

/** The same header without current-page marks, used while the pathname is not known yet. */
export function SiteHeaderView({ search, path }: { search: SearchItem[]; path: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(null);
        setMobile(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  return (
    <header ref={ref} className="sticky top-0 z-20 border-b border-hairline bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        <Link href="/" className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink lg:shrink-0">
          <span aria-hidden className="inline-block size-5 shrink-0 rounded-[5px] bg-[var(--accent)]" />
          <span className="truncate">
            <span className="hidden sm:inline">Corporate </span>Sustainability Intelligence
          </span>
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
          <Link href="/" aria-current={path === "/" ? "page" : undefined} className="rounded-md px-2.5 py-1.5 text-sm text-ink-2 hover:bg-[var(--hairline)] hover:text-ink aria-[current=page]:text-ink">
            Dashboard
          </Link>
          {GROUPS.map((g) => (
            <Menu key={g.label} group={g} path={path} open={open === g.label} onToggle={() => setOpen((o) => (o === g.label ? null : g.label))} onClose={() => setOpen(null)} />
          ))}
        </nav>
        <div className="hidden items-center gap-1 lg:flex">
          <CompanySearch items={search} />
          <ThemeSwitch />
        </div>
        <div className="flex shrink-0 items-center gap-1 lg:hidden">
          <ThemeSwitch />
          <button type="button" className="btn-secondary h-9" aria-expanded={mobile} aria-controls="mobile-nav" onClick={() => setMobile((m) => !m)}>
            {mobile ? "Close" : "Menu"}
          </button>
        </div>
      </div>
      {mobile && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-hairline px-4 pb-4 pt-3 lg:hidden">
          <CompanySearch items={search} onDone={() => setMobile(false)} />
          <ul className="mt-3 grid gap-4 sm:grid-cols-2">
            <li>
              <Link href="/" onClick={() => setMobile(false)} aria-current={path === "/" ? "page" : undefined} className="text-sm font-medium text-ink aria-[current=page]:underline">
                Dashboard
              </Link>
            </li>
            {GROUPS.map((g) => (
              <li key={g.label}>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{g.label}</p>
                <ul className="mt-1 flex flex-col">
                  {g.items.map((i) => (
                    <li key={i.href}>
                      <Link href={i.href} onClick={() => setMobile(false)} aria-current={isCurrent(path, i.href) ? "page" : undefined} className="block py-1.5 text-sm text-ink aria-[current=page]:font-semibold">
                        {i.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
