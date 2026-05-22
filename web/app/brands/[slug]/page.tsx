import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { VehicleCard } from "@/components/VehicleCard";
import { formatWarranty, asNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await prisma.brand.findUnique({
    where: { slug },
    include: {
      models: {
        include: { _count: { select: { commonIssues: true } } },
        orderBy: [{ startingMsrpCad: "asc" }, { name: "asc" }],
      },
    },
  });
  if (!brand) notFound();

  const featuredClass = brand.isFeatured
    ? brand.slug === "toyota"
      ? "from-toyota/20 via-transparent to-transparent"
      : "from-lexus-accent/20 via-transparent to-transparent"
    : "from-ink-700/30 via-transparent to-transparent";

  return (
    <>
      <section className={`border-b border-ink-700 bg-gradient-to-br ${featuredClass}`}>
        <div className="max-w-7xl mx-auto px-4 py-10">
          <Link href="/" className="text-zinc-500 text-sm hover:text-zinc-300">← All brands</Link>
          <h1 className="mt-2 text-4xl font-bold text-white">{brand.name}</h1>
          {brand.parentCompany && (
            <p className="text-zinc-400 text-sm">Parent: {brand.parentCompany} · {brand.country ?? "—"}</p>
          )}
          {brand.notesMd && (
            <p className="mt-4 max-w-3xl text-zinc-300 leading-relaxed">{brand.notesMd}</p>
          )}

          <dl className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Basic warranty" value={formatWarranty(brand.basicWarrantyMonths, brand.basicWarrantyKm)} />
            <Stat label="Powertrain" value={formatWarranty(brand.powertrainWarrantyMonths, brand.powertrainWarrantyKm)} />
            <Stat label="Hybrid battery" value={formatWarranty(brand.hybridBatteryMonths, brand.hybridBatteryKm)} />
            <Stat label="Corrosion" value={formatWarranty(brand.corrosionMonths, brand.corrosionKm)} />
            <Stat label="Reliability" value={brand.reliabilityScore ? `${asNumber(brand.reliabilityScore)!.toFixed(1)} / 10` : "—"} />
            <Stat label="Resale value" value={brand.resaleValueScore ? `${asNumber(brand.resaleValueScore)!.toFixed(1)} / 10` : "—"} />
            <Stat label="Dealer network" value={brand.dealerNetworkScore ? `${asNumber(brand.dealerNetworkScore)!.toFixed(1)} / 10` : "—"} />
            <Stat label="Models in DB" value={String(brand.models.length)} />
          </dl>

          {brand.websiteUrl && (
            <p className="mt-4 text-xs">
              <a href={brand.websiteUrl} target="_blank" rel="noreferrer" className="text-zinc-400 underline hover:text-zinc-200">
                Visit {brand.websiteUrl.replace(/^https?:\/\//, "")}
              </a>
            </p>
          )}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 py-8">
        <h2 className="text-lg font-semibold text-white mb-4">2025 / 2026 lineup</h2>
        {brand.models.length === 0 ? (
          <p className="text-zinc-500 text-sm">No models seeded for {brand.name} yet. Add them to <code className="text-xs bg-ink-800 px-1.5 py-0.5 rounded">src/db/comparison-seed-data.ts</code> and re-run <code className="text-xs bg-ink-800 px-1.5 py-0.5 rounded">npm run db:seed:comparison</code>.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {brand.models.map((m) => (
              <VehicleCard
                key={m.id}
                slug={m.slug}
                name={m.name}
                brandName={brand.name}
                brandSlug={brand.slug}
                brandIsFeatured={brand.isFeatured}
                bodyStyle={m.bodyStyle}
                segment={m.segment}
                startingMsrpCad={asNumber(m.startingMsrpCad)}
                issueCount={m._count.commonIssues}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</dt>
      <dd className="text-zinc-100 font-medium">{value}</dd>
    </div>
  );
}
