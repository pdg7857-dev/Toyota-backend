import Link from "next/link";
import { formatCad } from "@/lib/format";

export type VehicleCardProps = {
  slug: string;
  name: string;
  brandSlug?: string | null;
  brandName?: string | null;
  brandIsFeatured?: boolean;
  bodyStyle?: string | null;
  segment?: string | null;
  startingMsrpCad?: number | null;
  issueCount?: number;
};

export function VehicleCard({
  slug, name, brandSlug, brandName, brandIsFeatured,
  bodyStyle, segment, startingMsrpCad, issueCount,
}: VehicleCardProps) {
  const featuredAccent = brandIsFeatured && brandSlug
    ? brandSlug === "toyota"
      ? "border-l-toyota"
      : "border-l-lexus-accent"
    : "border-l-ink-700";

  return (
    <Link
      href={`/vehicles/${slug}`}
      className={`block p-4 rounded-lg bg-ink-800 border border-ink-700 border-l-4 ${featuredAccent} hover:bg-ink-700/60 transition-colors`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h4 className="font-semibold text-zinc-100">{name}</h4>
        <span className="text-toyota text-sm font-mono whitespace-nowrap">
          {startingMsrpCad ? `from ${formatCad(startingMsrpCad)}` : "MSRP —"}
        </span>
      </div>
      <p className="text-xs text-zinc-400">
        {brandName && <span className="text-zinc-300">{brandName}</span>}
        {brandName && (bodyStyle || segment) && <span className="mx-1.5 text-zinc-600">·</span>}
        {bodyStyle ?? segment}
      </p>
      {issueCount && issueCount > 0 ? (
        <p className="mt-2 text-[11px] text-amber-400/80">
          {issueCount} known issue{issueCount === 1 ? "" : "s"} on record
        </p>
      ) : null}
    </Link>
  );
}
