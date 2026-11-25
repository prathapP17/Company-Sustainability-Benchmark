"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const BTN = "rounded border border-hairline px-3 py-1.5 text-sm text-ink hover:border-ink-muted disabled:opacity-50";
const BTN_PRIMARY = "rounded bg-accent px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50";
const INPUT = "w-full rounded border border-hairline bg-surface px-2 py-1.5 text-sm text-ink";
const MIN = 12;

async function post(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

/** Set a password with a one-time link. The token is read from the URL fragment, which never reaches the server's logs. */
export function SetPasswordForm() {
  const tokenRef = useRef<string | null>(null);
  const [info, setInfo] = useState<{ purpose: string; name: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Kept in a ref: development mode runs effects twice, and the fragment is gone after the first run.
    const t = tokenRef.current ?? window.location.hash.slice(1);
    tokenRef.current = t;
    // Remove the token from the address bar and history straight away.
    window.history.replaceState(null, "", window.location.pathname);
    let cancelled = false;
    const check = t
      ? post("/api/pipeline/links/check", { token: t })
      : Promise.resolve({ ok: false, data: { error: "This page needs the full link you were given (it ends with # and a long code)." } as Record<string, unknown> });
    check.then((r) => {
      if (cancelled) return;
      if (r.ok) setInfo(r.data as { purpose: string; name: string; email: string });
      else setError(String(r.data.error ?? "this link does not work"));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (done) {
    return (
      <p role="status" className="text-sm text-ink-2">
        Password set. <a href="/review" className="text-accent hover:underline">Sign in</a> with {info?.email}.
      </p>
    );
  }
  if (error && !info) return <p role="alert" className="text-sm text-warn-ink">{error}</p>;
  if (!info) return <p className="text-sm text-ink-muted">Checking the link…</p>;
  return (
    <form
      className="flex max-w-sm flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const pw = String(f.get("password") ?? "");
        if (pw !== f.get("confirm")) return setError("the two passwords differ");
        setBusy(true);
        setError(null);
        const r = await post("/api/pipeline/links/use", { token: tokenRef.current, password: pw });
        setBusy(false);
        if (!r.ok) setError(String(r.data.error ?? "failed"));
        else setDone(true);
      }}
    >
      <p className="text-sm text-ink-2">
        {info.purpose === "invite" ? "Welcome" : "Reset the password for"} <b className="text-ink">{info.name}</b> ({info.email}).
      </p>
      <input type="email" name="username" value={info.email} autoComplete="username" readOnly hidden />
      <label className="text-sm text-ink-2">
        New password (at least {MIN} characters)
        <input name="password" type="password" required minLength={MIN} maxLength={200} className={INPUT} autoComplete="new-password" />
      </label>
      <label className="text-sm text-ink-2">
        Repeat it
        <input name="confirm" type="password" required minLength={MIN} maxLength={200} className={INPUT} autoComplete="new-password" />
      </label>
      {error && <p role="alert" className="text-sm text-warn-ink">{error}</p>}
      <button className={BTN_PRIMARY} disabled={busy}>
        Set password
      </button>
    </form>
  );
}

export function ChangePasswordForm() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex max-w-sm flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        if (f.get("next") !== f.get("confirm")) return setMsg({ ok: false, text: "the two new passwords differ" });
        setBusy(true);
        const r = await post("/api/pipeline/account/password", { current: f.get("current"), next: f.get("next") });
        setBusy(false);
        if (r.ok) form.reset();
        setMsg(r.ok ? { ok: true, text: "Password changed. Other devices were signed out." } : { ok: false, text: String(r.data.error ?? "failed") });
      }}
    >
      <label className="text-sm text-ink-2">
        Current password
        <input name="current" type="password" required maxLength={200} className={INPUT} autoComplete="current-password" />
      </label>
      <label className="text-sm text-ink-2">
        New password (at least {MIN} characters)
        <input name="next" type="password" required minLength={MIN} maxLength={200} className={INPUT} autoComplete="new-password" />
      </label>
      <label className="text-sm text-ink-2">
        Repeat the new password
        <input name="confirm" type="password" required minLength={MIN} maxLength={200} className={INPUT} autoComplete="new-password" />
      </label>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-ink-2" : "text-warn-ink"}`}>
          {msg.text}
        </p>
      )}
      <button className={BTN_PRIMARY} disabled={busy}>
        Change password
      </button>
    </form>
  );
}

export function SignOutOthersButton() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        className={BTN}
        onClick={async () => {
          const r = await post("/api/pipeline/account/sessions", {});
          setMsg(r.ok ? `Signed out ${r.data.signedOut} other session(s).` : String(r.data.error ?? "failed"));
        }}
      >
        Sign out other devices
      </button>
      {msg && <span role="status" className="text-sm text-ink-2">{msg}</span>}
    </div>
  );
}

const ROLE_HELP: Record<string, string> = {
  admin: "Admin: everything, including accounts",
  reviewer: "Reviewer: upload, fetch, approve and reject",
  viewer: "Viewer: read-only access to the review area",
};

function LinkBox({ link, hours }: { link: string; hours: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1 rounded border border-hairline p-2">
      <p className="text-xs text-ink-2">
        One-time link, valid for {hours} hours. Send it to the person yourself (it is shown only now and works once):
      </p>
      <div className="flex gap-2">
        <input readOnly value={link} className={`${INPUT} font-mono text-xs`} aria-label="One-time link" onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className={BTN}
          onClick={async () => {
            await navigator.clipboard.writeText(link).catch(() => {});
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function InviteForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ link: string; hours: number } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          setBusy(true);
          setError(null);
          setLink(null);
          const r = await post("/api/pipeline/users", { email: f.get("email"), name: f.get("name"), role: f.get("role") });
          setBusy(false);
          if (!r.ok) return setError(String(r.data.error ?? "failed"));
          setLink({ link: String(r.data.link), hours: Number(r.data.expiresInHours) });
          form.reset();
          router.refresh();
        }}
      >
        <label className="text-sm text-ink-2">
          Email
          <input name="email" type="email" required maxLength={254} className={INPUT} autoComplete="off" />
        </label>
        <label className="text-sm text-ink-2">
          Name (shown in the audit trail)
          <input name="name" required maxLength={60} className={INPUT} autoComplete="off" />
        </label>
        <label className="text-sm text-ink-2">
          Role
          <select name="role" className={INPUT} defaultValue="reviewer">
            {Object.entries(ROLE_HELP).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-3">
          <button className={BTN_PRIMARY} disabled={busy}>
            Create account and link
          </button>
        </div>
      </form>
      {error && <p role="alert" className="text-sm text-warn-ink">{error}</p>}
      {link && <LinkBox link={link.link} hours={link.hours} />}
    </div>
  );
}

export function UserActions({ id, name, role, disabled, isSelf }: { id: number; name: string; role: string; disabled: boolean; isSelf: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ link: string; hours: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const r = await post(`/api/pipeline/users/${id}`, body);
    setBusy(false);
    if (!r.ok) return setError(String(r.data.error ?? "failed"));
    if (r.data.link) setLink({ link: String(r.data.link), hours: Number(r.data.expiresInHours) });
    router.refresh();
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`Role for ${name}`}
          className="rounded border border-hairline bg-surface px-2 py-1 text-sm text-ink"
          value={role}
          disabled={busy}
          onChange={(e) => act({ action: "role", role: e.target.value })}
        >
          <option value="admin">admin</option>
          <option value="reviewer">reviewer</option>
          <option value="viewer">viewer</option>
        </select>
        {!disabled && (
          <button className={BTN} disabled={busy} onClick={() => act({ action: "link" })}>
            New password link
          </button>
        )}
        <button className={BTN} disabled={busy} onClick={() => act({ action: "revoke" })}>
          {isSelf ? "Sign out other devices" : "Sign out everywhere"}
        </button>
        {!isSelf && (
          <button className={BTN} disabled={busy} onClick={() => act({ action: disabled ? "enable" : "disable" })}>
            {disabled ? "Enable" : "Disable"}
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-warn-ink">{error}</p>}
      {link && <LinkBox link={link.link} hours={link.hours} />}
    </div>
  );
}
