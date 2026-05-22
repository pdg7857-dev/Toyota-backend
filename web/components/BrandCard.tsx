import Link from "next/link";

export type BrandCardProps = {
  slug: string;
  name: string;
  isFeatured: boolean;
  modelCount: number;
  reliabilityScore?: number | null;
  resaleValueScore?: number | null;
  basicWarranty?: string;
  powertrainWarranty?: string;
  notesMd?: string | null;
};

export function BrandCard({
  slug, name, isFeatured, modelCount, reliabilityScore, resaleValueScore,
  basicWarranty, powertrainWarranty, notesMd,
}: BrandCardProps) {
  const featuredStyle = isFeatured
    ? slug === "toyota"
      ? "border-toyota/60 bg-gradient-to-br from-toyota/10 to-transparent ring-1 ring-toyota/30"
      : "border-lexus-accent/60 bg-gradient-to-br from-lexus-accent/10 to-transparent ring-1 ring-lexus-accent/30"
    : "border-ink-700 bg-ink-800 hover:border-zinc-600";

  return (
    <Link
      href={`/brands/${slug}`}
      className={`block p-5 rounded-xl border transition-all hover:translate-y-[-1px] hover:shadow-lg ${featuredStyle}`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3 className="text-lg font-semibold text-white">{name}</h3>
        {isFeatured && (
          <span className={`text-[10px] uppercase tracking-wider font-semibold ${slug === "toyota" ? "text-toyota" : "text-lexus-accent"}`}>
            Featured
          </span>
        )}
      </div>
      <p className="text-xs text-zinc-500 mb-3">{modelCount} {modelCount === 1 ? "model" : "models"} listed</p>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-zinc-500">Basic</dt>
        <dd className="text-zinc-300 text-right">{basicWarranty ?? "—"}</dd>
        <dt className="text-zinc-500">Powertrain</dt>
        <dd className="text-zinc-300 text-right">{powertrainWarranty ?? "—"}</dd>
        {reliabilityScore !== null && reliabilityScore !== undefined && (
          <>
            <dt className="text-zinc-500">Reliability</dt>
            <dd className="text-zinc-300 text-right">{reliabilityScore.toFixed(1)} / 10</dd>
          </>
        )}
        {resaleValueScore !== null && resaleValueScore !== undefined && (
          <>
            <dt className="text-zinc-500">Resale</dt>
            <dd className="text-zinc-300 text-right">{resaleValueScore.toFixed(1)} / 10</dd>
          </>
        )}
      </dl>

      {notesMd && isFeatured && (
        <p className="mt-3 text-xs text-zinc-400 line-clamp-3">{notesMd}</p>
      )}
    </Link>
  );
}
