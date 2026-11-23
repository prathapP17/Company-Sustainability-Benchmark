import Link from "next/link";

export default function CompanyNotFound() {
  return (
    <div className="flex flex-col gap-2 py-10">
      <h1 className="text-xl font-semibold text-ink">Company not found</h1>
      <p className="text-sm text-ink-2">This company is not in the benchmark yet.</p>
      <Link href="/" className="text-sm text-accent hover:underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
