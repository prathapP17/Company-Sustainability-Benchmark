import { LoginForm } from "@/components/review/ReviewClient";
import type { AccessResult } from "@/lib/pipeline/access";

export function Denied({ access }: { access: Extract<AccessResult, { ok: false }> }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-2">{access.reason}</p>
      {access.status === 401 && !access.noAccounts && <LoginForm />}
      {access.noAccounts && (
        <div className="max-w-2xl text-sm text-ink-2">
          <p>Run this in the project folder (or inside the app container) to create the first admin. It prints a one-time link for setting the password:</p>
          <pre className="mt-2 overflow-x-auto rounded border border-hairline bg-surface p-3 text-xs">
            npm run users -- invite --email you@example.org --name &quot;Your Name&quot; --role admin
          </pre>
        </div>
      )}
    </div>
  );
}
