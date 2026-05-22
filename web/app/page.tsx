import { prisma } from "@/lib/db";
import Link from "next/link";
import { BrandCard } from "@/components/BrandCard";
import { VehicleCard } from "@/components/VehicleCard";
import { formatWarranty, asNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const brandsRaw = await prisma.brand.findMany({
    include: { _count: { select: { models: true } } },
    orderBy: [{ isFeatured: "desc" }, { name: "asc" }],
  });

  // Toyota + Lexus featured vehicles surfaced on the home page.
  const featuredVehicles = await prisma.model.findMany({
    where: {
      brand: { isFeatured: true },
      startingMsrpCad: { not: null },
    },
    include: {
      brand: true,
      _count: { select: { commonIssues: true } },
    },
    orderBy: [{ brand: { name: "asc" } }, { name: "asc" }],
    take: 12,
  });

  return (
    <>
      <section className="border-b border-ink-700 bg-gradient-to-br from-toyota/10 via-transparent to-lexus-accent/10">
        <div className="max-w-7xl mx-auto px-4 py-12">
          <h1 className="text-3xl md:text-5xl font-bold text-white tracking-tight">
            Every <span className="text-toyota">2025/2026 car</span> sold in Ontario.<br className="hidden md:block" />
            <span className="text-lexus-accent">Cross-referenced.</span>{" "}
            <span className="text-zinc-400 font-medium">Pricing, warranty, ownership cost, common issues.</span>
          </h1>
          <p className="mt-4 max-w-3xl text-zinc-300">
            A live database that pulls from official OEM Canadian sites, Transport Canada recalls, and
            Reddit owner discussions. <span className="text-zinc-100 font-medium">Toyota and Lexus are featured</span>{" "}
            — they have the deepest data and editorial coverage. Other brands have starting MSRP, warranty,
            and curated pros/cons; expand each one as needed.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/compare" className="px-4 py-2 bg-toyota text-white font-semibold rounded-md hover:bg-toyota-dark transition-colors">
              Compare vehicles →
            </Link>
            <Link href="/vehicles" className="px-4 py-2 bg-ink-700 text-zinc-100 font-semibold rounded-md hover:bg-ink-700/70 transition-colors">
              Browse all vehicles
            </Link>
            <Link href="/issues" className="px-4 py-2 border border-ink-700 text-zinc-300 rounded-md hover:border-zinc-500 transition-colors">
              Known issues
            </Link>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 py-10">
        <h2 className="text-xl font-semibold text-white mb-1">Featured vehicles</h2>
        <p className="text-sm text-zinc-500 mb-5">2025 / 2026 Toyota and Lexus models — the deepest data set in this catalog.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {featuredVehicles.map((v) => (
            <VehicleCard
              key={v.id}
              slug={v.slug}
              name={v.name}
              brandSlug={v.brand?.slug}
              brandName={v.brand?.name}
              brandIsFeatured={v.brand?.isFeatured}
              bodyStyle={v.bodyStyle}
              segment={v.segment}
              startingMsrpCad={asNumber(v.startingMsrpCad)}
              issueCount={v._count.commonIssues}
            />
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 pb-12">
        <h2 className="text-xl font-semibold text-white mb-1">All brands</h2>
        <p className="text-sm text-zinc-500 mb-5">{brandsRaw.length} makes available for sale in Ontario for the 2025/2026 model years.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {brandsRaw.map((b) => (
            <BrandCard
              key={b.id}
              slug={b.slug}
              name={b.name}
              isFeatured={b.isFeatured}
              modelCount={b._count.models}
              reliabilityScore={asNumber(b.reliabilityScore)}
              resaleValueScore={asNumber(b.resaleValueScore)}
              basicWarranty={formatWarranty(b.basicWarrantyMonths, b.basicWarrantyKm)}
              powertrainWarranty={formatWarranty(b.powertrainWarrantyMonths, b.powertrainWarrantyKm)}
              notesMd={b.notesMd}
            />
          ))}
        </div>
      </section>
    </>
  );
}
