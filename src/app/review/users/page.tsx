import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Tag } from "@/components/ui";
import { InviteForm, UserActions } from "@/components/review/AccountClient";
import { isLocked, listUsers } from "@/lib/auth/accounts";
import { pipelineDb } from "@/lib/pipeline/db";
import { currentAccess } from "../gate";
import { Denied } from "../Denied";

export const metadata: Metadata = { title: "Users", robots: { index: false, follow: false } };

export default function UsersPage() {
  return (
    <div className="flex flex-col gap-6">
      <nav className="text-xs text-ink-muted">
        <Link href="/review" className="hover:underline">
          Upload and review
        </Link>{" "}
        / Users
      </nav>
      <div>
        <h1 className="text-2xl font-semibold text-ink">Users</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          The app sends no email: creating an account or a password reset gives you a one-time link to pass on. Every change
          here is recorded in the audit log.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
        <Users />
      </Suspense>
    </div>
  );
}

async function Users() {
  const access = await currentAccess("admin");
  if (!access.ok) return <Denied access={access} />;
  const users = listUsers(pipelineDb());
  return (
    <>
      <Card title="Add an account">
        <InviteForm />
      </Card>
      <Card title={`Accounts (${users.length})`}>
        <ul className="flex flex-col gap-4">
          {users.map((u) => {
            const locked = isLocked(u);
            return (
              <li key={u.id} className="flex flex-col gap-2 border-b border-hairline pb-4 last:border-0 last:pb-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium break-words text-ink">
                    {u.name} <span className="font-normal text-ink-muted">· {u.email}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 text-xs text-ink-muted">
                    <Tag>{u.role}</Tag>
                    {u.disabled_at && <Tag tone="warn">Disabled</Tag>}
                    {!u.password_hash && !u.disabled_at && <Tag tone="warn">Invite not used yet</Tag>}
                    {locked && <Tag tone="warn">Locked until {u.locked_until!.slice(11, 16)} UTC</Tag>}
                    <span>
                      added {u.created_at.slice(0, 10)} by {u.created_by}
                      {u.last_login_at ? ` · last sign-in ${u.last_login_at.slice(0, 16).replace("T", " ")} UTC` : " · never signed in"}
                    </span>
                  </div>
                </div>
                <UserActions id={u.id} name={u.name} role={u.role} disabled={!!u.disabled_at} isSelf={u.id === access.user.id} />
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
