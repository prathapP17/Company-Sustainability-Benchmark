"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const BTN = "rounded border border-hairline px-3 py-1.5 text-sm text-ink hover:border-ink-muted disabled:opacity-50";
const BTN_PRIMARY = "rounded bg-accent px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50";
const INPUT = "w-full rounded border border-hairline bg-surface px-2 py-1.5 text-sm text-ink";

async function post(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex max-w-sm flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        const r = await post("/api/pipeline/login", { name: f.get("name"), token: f.get("token") });
        setBusy(false);
        if (!r.ok) setError(String(r.data.error ?? "sign-in failed"));
        else router.refresh();
      }}
    >
      <label className="text-sm text-ink-2">
        Your name (recorded in the audit trail)
        <input name="name" required maxLength={60} className={INPUT} autoComplete="name" />
      </label>
      <label className="text-sm text-ink-2">
        Reviewer token (from .env.local)
        <input name="token" type="password" required className={INPUT} autoComplete="current-password" />
      </label>
      {error && <p role="alert" className="text-sm text-warn-ink">{error}</p>}
      <button className={BTN_PRIMARY} disabled={busy}>
        Sign in
      </button>
    </form>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="text-sm text-accent hover:underline"
      onClick={async () => {
        await post("/api/pipeline/logout", {});
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}

const REPORT_TYPES = ["sustainability_report", "integrated_report", "annual_report", "esg_data_book", "regulatory_filing", "webpage", "other"];
const CLASSES: [string, string][] = [
  ["primary_document", "Primary document (company report or filing)"],
  ["official_webpage", "Official webpage"],
  ["provider_website", "Data provider website"],
  ["secondary_source", "Secondary source (low confidence)"],
  ["search_excerpt", "Search excerpt (low confidence)"],
];

export function UploadForm({ companies }: { companies: { id: string; name: string }[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const form = e.currentTarget;
        const res = await fetch("/api/pipeline/upload", { method: "POST", body: new FormData(form) });
        const data = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) setMsg(`Upload failed: ${data.error ?? res.status}`);
        else {
          setMsg(data.duplicate ? `Already uploaded (document #${data.documentId}); not processed again.` : `Uploaded as document #${data.documentId}. The worker will extract it.`);
          form.reset();
          router.refresh();
        }
      }}
    >
      <label className="text-sm text-ink-2 sm:col-span-2">
        File (PDF, XLSX or XHTML, up to 50 MB)
        <input name="file" type="file" required accept=".pdf,.xlsx,.xhtml,.html,.htm" className={INPUT} />
      </label>
      <label className="text-sm text-ink-2">
        Company
        <select name="companyId" required className={INPUT}>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm text-ink-2">
        Title
        <input name="title" maxLength={200} placeholder="e.g. Sustainability Report 2026" className={INPUT} />
      </label>
      <label className="text-sm text-ink-2">
        Report type
        <select name="reportType" className={INPUT} defaultValue="sustainability_report">
          {REPORT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm text-ink-2">
        Reporting year (company&apos;s own label)
        <input name="reportingYear" inputMode="numeric" pattern="\d{4}" placeholder="2025" className={INPUT} />
      </label>
      <label className="text-sm text-ink-2">
        Source class
        <select name="verificationClass" className={INPUT} defaultValue="primary_document">
          {CLASSES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm text-ink-2">
        Public URL of the document (recommended)
        <input name="sourceUrl" type="url" placeholder="https://…" className={INPUT} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className={BTN_PRIMARY} disabled={busy}>
          {busy ? "Uploading…" : "Upload"}
        </button>
        {msg && <p role="status" className="text-sm text-ink-2">{msg}</p>}
      </div>
    </form>
  );
}

export function RequeueButton({ documentId }: { documentId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={BTN}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await post(`/api/pipeline/documents/${documentId}/requeue`, {});
        setBusy(false);
        router.refresh();
      }}
    >
      Re-run extraction
    </button>
  );
}

export function ReviewActions({
  id,
  status,
  conflict,
}: {
  id: number;
  status: string;
  conflict: "duplicate" | "conflict" | null;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (status !== "pending" && status !== "blocked") return null;

  const act = async (action: string) => {
    setBusy(true);
    setError(null);
    const r = await post(`/api/pipeline/extractions/${id}`, { action, reason: reason || undefined });
    setBusy(false);
    if (!r.ok) setError(String(r.data.error ?? "failed"));
    else router.refresh();
  };

  const needsReason = status === "blocked" || conflict === "conflict";
  return (
    <div className="mt-2 flex flex-col gap-2">
      <input
        aria-label="Reason"
        className={INPUT}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={needsReason ? "Reason (required)" : "Reason (optional)"}
        maxLength={500}
      />
      <div className="flex flex-wrap gap-2">
        {status === "blocked" ? (
          <button className={BTN} disabled={busy || !reason.trim()} onClick={() => act("override_approve")}>
            Override and approve
          </button>
        ) : conflict === "conflict" ? (
          <button className={BTN_PRIMARY} disabled={busy || !reason.trim()} onClick={() => act("approve_restatement")}>
            Approve as restatement
          </button>
        ) : (
          <button className={BTN_PRIMARY} disabled={busy} onClick={() => act("approve")}>
            {conflict === "duplicate" ? "Confirm (no change)" : "Approve"}
          </button>
        )}
        <button className={BTN} disabled={busy} onClick={() => act("reject")}>
          Reject
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-warn-ink">
          {error}
        </p>
      )}
    </div>
  );
}

export function DiscoveredActions({ id, canFetch }: { id: number; canFetch: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: "fetch" | "skip") => {
    setBusy(true);
    setError(null);
    const r = await post(`/api/pipeline/discovered/${id}`, { action });
    setBusy(false);
    if (!r.ok) setError(String(r.data.error ?? "failed"));
    else router.refresh();
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        {canFetch && (
          <button className={BTN_PRIMARY} disabled={busy} onClick={() => act("fetch")}>
            {busy ? "Fetching…" : "Fetch"}
          </button>
        )}
        <button className={BTN} disabled={busy} onClick={() => act("skip")}>
          Skip
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-warn-ink">
          {error}
        </p>
      )}
    </div>
  );
}

export function AcknowledgeButton({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={BTN}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await post(`/api/pipeline/alerts/${id}`, {});
        setBusy(false);
        router.refresh();
      }}
    >
      Acknowledge
    </button>
  );
}
