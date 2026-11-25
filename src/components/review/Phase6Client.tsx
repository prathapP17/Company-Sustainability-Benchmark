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

export function GenerateSummaryButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button
        className={BTN}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          const r = await post(`/api/pipeline/summaries/${id}`, {});
          setBusy(false);
          if (!r.ok) setMsg({ ok: false, text: String(r.data.error ?? "failed") });
          else setMsg(r.data.ok ? { ok: true, text: "Published" } : { ok: false, text: `Not published: ${(r.data.problems as string[]).slice(0, 2).join("; ")}` });
          router.refresh();
        }}
      >
        {busy ? "Writing… (up to a minute)" : label}
      </button>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`max-w-xs text-xs ${msg.ok ? "text-ink-2" : "text-warn-ink"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

export function NewsActions({ id, approved }: { id: number; approved: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: "approve" | "reject") => {
    setBusy(true);
    setError(null);
    const r = await post(`/api/pipeline/news/${id}`, { action, note });
    setBusy(false);
    if (!r.ok) setError(String(r.data.error ?? "failed"));
    else router.refresh();
  };
  if (approved) {
    return (
      <button className={BTN} disabled={busy} onClick={() => act("reject")}>
        Withdraw
      </button>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2 sm:w-72">
      <input aria-label="Why it is relevant" className={INPUT} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it is relevant (shown publicly)" maxLength={280} />
      <div className="flex gap-2">
        <button className={BTN_PRIMARY} disabled={busy || note.trim().length < 10} onClick={() => act("approve")}>
          Approve
        </button>
        <button className={BTN} disabled={busy} onClick={() => act("reject")}>
          Reject
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-warn-ink">{error}</p>}
    </div>
  );
}
