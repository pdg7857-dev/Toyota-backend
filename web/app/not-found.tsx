import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-20 text-center">
      <h1 className="text-3xl font-bold text-white">Not in the database</h1>
      <p className="mt-3 text-zinc-400">
        That brand or vehicle isn&apos;t in the catalog yet. If you think it should be,
        add it to <code className="text-xs bg-ink-800 px-1.5 py-0.5 rounded">src/db/comparison-seed-data.ts</code>{" "}
        and re-run the seed.
      </p>
      <Link href="/" className="mt-6 inline-block text-toyota hover:underline">← Back to all brands</Link>
    </div>
  );
}
