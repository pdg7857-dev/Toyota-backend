import { prisma } from "@/lib/db";
import Link from "next/link";
import { VehicleCard } from "@/components/VehicleCard";
import { asNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

type Search = { [key: string]: string | string[] | undefined };

const SEGMENTS = [
  "Compact car",
  "Midsize sedan",
  "Compact SUV",
  "Midsize SUV (3-row)",
  "Midsize 3-row SUV",
  "Midsize wagon",
  "Compact luxury sedan",
  "Midsize luxury sedan",
  "Compact luxury SUV",
  "Midsize luxury SUV",
  "Compact truck",
  "Midsize truck",
  "Full-size truck",
  "Minivan",
  "Compact hybrid",
  "Compact PHEV",
  "Electric sedan",
  "Electric SUV",
  "Grand tourer",
];

export default async function VehiclesIndex({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const segment = typeof sp.segment === "string" ? sp.segment : undefined;
  const brandSlug = typeof sp.brand === "string" ? sp.brand : undefined;
  const maxPriceStr = typeof sp.maxPrice === "string" ? sp.maxPrice : undefined;
  const maxPrice = maxPriceStr ? Number(maxPriceStr) : undefined;
  const sort = typeof sp.sort === "string" ? sp.sort : "featured";

  const brands = await prisma.brand.findMany({ orderBy: [{ isFeatured: "desc" }, { name: "asc" }] });

  const models = await prisma.model.findMany({
    where: {
      ...(segment ? { segment: { contains: segment } } : {}),
      ...(brandSlug ? { brand: { slug: brandSlug } } : {}),
      ...(maxPrice ? { startingMsrpCad: { lte: maxPrice } } : {}),
    },
    include: {
      brand: true,
      _count: { select: { commonIssues: true } },
    },
    orderBy:
      sort === "price-asc" ? [{ startingMsrpCad: "asc" }]
      : sort === "price-desc" ? [{ startingMsrpCad: "desc" }]
      : sort === "name" ? [{ name: "asc" }]
      : [{ brand: { isFeatured: "desc" } }, { brand: { name: "asc" } }, { startingMsrpCad: "asc" }],
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-white mb-1">All vehicles</h1>
      <p className="text-sm text-zinc-500 mb-6">{models.length} models match your filters.</p>

      <form className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6 p-4 bg-ink-800 border border-ink-700 rounded-lg" action="/vehicles">
        <label className="text-xs text-zinc-400">
          Brand
          <select name="brand" defaultValue={brandSlug ?? ""} className="mt-1 w-full bg-ink-900 border border-ink-700 rounded px-2 py-1.5 text-zinc-100 text-sm">
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.isFeatured ? "★ " : ""}{b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-zinc-400">
          Segment
          <select name="segment" defaultValue={segment ?? ""} className="mt-1 w-full bg-ink-900 border border-ink-700 rounded px-2 py-1.5 text-zinc-100 text-sm">
            <option value="">All segments</option>
            {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-xs text-zinc-400">
          Max starting MSRP (CAD)
          <input
            name="maxPrice"
            type="number"
            inputMode="numeric"
            defaultValue={maxPriceStr ?? ""}
            placeholder="e.g. 50000"
            className="mt-1 w-full bg-ink-900 border border-ink-700 rounded px-2 py-1.5 text-zinc-100 text-sm"
          />
        </label>
        <label className="text-xs text-zinc-400">
          Sort
          <select name="sort" defaultValue={sort} className="mt-1 w-full bg-ink-900 border border-ink-700 rounded px-2 py-1.5 text-zinc-100 text-sm">
            <option value="featured">Featured first</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
            <option value="name">Name (A → Z)</option>
          </select>
        </label>
        <div className="md:col-span-4 flex gap-2">
          <button className="px-4 py-1.5 bg-toyota text-white rounded text-sm font-semibold">Apply</button>
          <Link href="/vehicles" className="px-4 py-1.5 bg-ink-700 text-zinc-300 rounded text-sm">Clear</Link>
        </div>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {models.map((m) => (
          <VehicleCard
            key={m.id}
            slug={m.slug}
            name={m.name}
            brandSlug={m.brand?.slug}
            brandName={m.brand?.name}
            brandIsFeatured={m.brand?.isFeatured}
            bodyStyle={m.bodyStyle}
            segment={m.segment}
            startingMsrpCad={asNumber(m.startingMsrpCad)}
            issueCount={m._count.commonIssues}
          />
        ))}
      </div>
    </div>
  );
}
