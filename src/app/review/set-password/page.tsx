import type { Metadata } from "next";
import { SetPasswordForm } from "@/components/review/AccountClient";

export const metadata: Metadata = { title: "Set your password", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function SetPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Set your password</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Invite and reset links work once and expire (invites after 72 hours, resets after 2 hours).
        </p>
      </div>
      <SetPasswordForm />
    </div>
  );
}
