import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card } from "@/components/ui";
import { ChangePasswordForm, SignOutOthersButton } from "@/components/review/AccountClient";
import { currentAccess } from "../gate";
import { Denied } from "../Denied";

export const metadata: Metadata = { title: "Your account", robots: { index: false, follow: false } };

export default function AccountPage() {
  return (
    <div className="flex flex-col gap-6">
      <nav className="text-xs text-ink-muted">
        <Link href="/review" className="hover:underline">
          Upload and review
        </Link>{" "}
        / Account
      </nav>
      <h1 className="text-2xl font-semibold text-ink">Your account</h1>
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
        <Account />
      </Suspense>
    </div>
  );
}

async function Account() {
  const access = await currentAccess();
  if (!access.ok) return <Denied access={access} />;
  return (
    <>
      <p className="text-sm text-ink-2">
        {access.user.name} · {access.user.email} · role: {access.user.role}
      </p>
      <Card title="Change password">
        <ChangePasswordForm />
      </Card>
      <Card title="Sessions">
        <p className="mb-3 text-sm text-ink-2">Sessions end after 8 hours without activity, and after 7 days at the latest.</p>
        <SignOutOthersButton />
      </Card>
    </>
  );
}
