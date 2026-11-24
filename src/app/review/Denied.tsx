import { LoginForm } from "@/components/review/ReviewClient";
import type { AccessResult } from "@/lib/pipeline/access";

export function Denied({ access }: { access: Extract<AccessResult, { ok: false }> }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-2">{access.reason}</p>
      {access.status === 401 && <LoginForm />}
      {access.status === 404 && (
        <p className="text-xs text-ink-muted">
          Set REVIEWER_TOKEN (at least 16 characters) in .env.local and restart the server to enable it.
        </p>
      )}
    </div>
  );
}
