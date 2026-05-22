import { prisma } from "@/lib/db";
import Link from "next/link";
import { formatCad, formatWarranty, asNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

type Search = { [key: string]: string | string[] | undefined };

export default async function ComparePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const slugsParam = typeof sp.slugs === "string" ? sp.slugs : Array.isArray(sp.slugs) ? sp.slugs.join(",") : "";
  const slugs = slugsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);

  const [allModels, comparing] = await Promise.all([
    prisma.model.findMany({
      include: { brand: true },
      orderBy: [{ brand: { isFeatured: "desc" } }, { brand: { name: "asc" } }, { name: "asc" }],
    }),
    slugs.length > 0
      ? prisma.model.findMany({
          where: { slug: { in: slugs } },
          include: {
            brand: true,
            ownershipCosts: { orderBy: { year: "desc" }, take: 1 },
            commonIssues: { orderBy: [{ severity: "desc" }, { mentionCount: "desc" }], take: 3 },
            prosCons: { orderBy: [{ weight: "desc" }] },
          },
        })
      : Promise.resolve([]),
  ]);

  // Keep the order the user requested in the URL.
  const ordered = slugs.map((s) => comparing.find((c) => c.slug === s)).filter(Boolean) as typeof comparing;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-white mb-1">Cross-reference compare</h1>
      <p className="text-sm text-zinc-500 mb-6">
        Pick up to 4 vehicles. URL is shareable: <code className="text-xs text-zinc-300 bg-ink-800 px-1.5 py-0.5 rounded">/compare?slugs=rav4,cr-v</code>
      </p>

      <ComparePicker allModels={allModels} chosen={slugs} />

      {ordered.length === 0 ? (
        <p className="mt-8 text-zinc-500">Add at least one vehicle above to begin comparing.</p>
      ) : (
        <CompareTable models={ordered} />
      )}
    </div>
  );
}

function ComparePicker({
  allModels,
  chosen,
}: {
  allModels: Array<{ slug: string; name: string; brand: { name: string; slug: string; isFeatured: boolean } | null }>;
  chosen: string[];
}) {
  // Server-rendered chooser using form submit — works without JS, and the
  // URL stays the source of truth so the compare is shareable.
  return (
    <form action="/compare" className="p-4 bg-ink-800 border border-ink-700 rounded-lg">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <SlotSelect key={i} allModels={allModels} chosen={chosen} index={i} />
        ))}
      </div>
      <input type="hidden" name="slugs" id="slugs-combined" />
      <div className="mt-4 flex gap-2 items-center">
        <button
          type="submit"
          formAction="/compare"
          className="px-4 py-1.5 bg-toyota text-white text-sm font-semibold rounded"
          // hidden form-submit: we read the four slot-* selects via inline JS-less trick:
          // each select's `name` is "slot-N" and we use a tiny progressive-enhancement
          // script below to populate the `slugs` hidden field on submit.
        >
          Compare →
        </button>
        <Link href="/compare" className="px-4 py-1.5 bg-ink-700 text-zinc-300 text-sm rounded">Clear</Link>
        {chosen.length > 0 && (
          <span className="ml-auto text-xs text-zinc-500">
            Comparing {chosen.length} of 4 slots
          </span>
        )}
      </div>
      {/* Progressive enhancement: combine the four slot selects into one slugs param. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function(){
              var form = document.currentScript.closest('form');
              form.addEventListener('submit', function(e){
                e.preventDefault();
                var picks = [];
                for (var i = 0; i < 4; i++) {
                  var sel = form.querySelector('select[name="slot-' + i + '"]');
                  if (sel && sel.value) picks.push(sel.value);
                }
                var url = '/compare' + (picks.length ? '?slugs=' + encodeURIComponent(picks.join(',')) : '');
                window.location.href = url;
              });
            })();
          `,
        }}
      />
    </form>
  );
}

function SlotSelect({
  allModels, chosen, index,
}: {
  allModels: Array<{ slug: string; name: string; brand: { name: string; slug: string; isFeatured: boolean } | null }>;
  chosen: string[];
  index: number;
}) {
  const value = chosen[index] ?? "";
  return (
    <label className="text-xs text-zinc-400">
      Vehicle {index + 1}
      <select
        name={`slot-${index}`}
        defaultValue={value}
        className="mt-1 w-full bg-ink-900 border border-ink-700 rounded px-2 py-1.5 text-zinc-100 text-sm"
      >
        <option value="">— pick a vehicle —</option>
        {allModels.map((m) => (
          <option key={m.slug} value={m.slug}>
            {m.brand?.isFeatured ? "★ " : ""}{m.brand?.name ?? "?"} {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function CompareTable({
  models,
}: {
  models: Array<{
    id: number;
    slug: string;
    name: string;
    bodyStyle: string | null;
    segment: string | null;
    startingMsrpCad: { toString(): string } | null;
    brand: {
      name: string; slug: string; isFeatured: boolean;
      basicWarrantyMonths: number | null; basicWarrantyKm: number | null;
      powertrainWarrantyMonths: number | null; powertrainWarrantyKm: number | null;
      hybridBatteryMonths: number | null; hybridBatteryKm: number | null;
      corrosionMonths: number | null; corrosionKm: number | null;
      reliabilityScore: { toString(): string } | null;
      resaleValueScore: { toString(): string } | null;
    } | null;
    ownershipCosts: Array<{
      tireFrontSize: string | null;
      estTireSetCad: { toString(): string } | null;
      oilType: string | null;
      estOilChangeCad: { toString(): string } | null;
      oilChangeIntervalKm: number | null;
      brakeJobFrontCad: { toString(): string } | null;
      dealerLabourRateCad: { toString(): string } | null;
      includedMaintenanceMonths: number | null;
      includedMaintenanceKm: number | null;
      fiveYearOwnershipCostCad: { toString(): string } | null;
    }>;
    commonIssues: Array<{ id: number; title: string; severity: string }>;
    prosCons: Array<{ id: number; isPro: boolean; text: string }>;
  }>;
}) {
  const cols = models.length;
  return (
    <div className="mt-8 overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="text-left text-xs uppercase tracking-wider text-zinc-500 w-44 align-bottom pb-3"></th>
            {models.map((m) => {
              const accent = m.brand?.isFeatured
                ? m.brand.slug === "toyota" ? "border-t-toyota" : "border-t-lexus-accent"
                : "border-t-ink-700";
              return (
                <th key={m.id} className={`text-left bg-ink-800 px-4 py-3 border-t-4 ${accent} border-x border-ink-700`}>
                  <Link href={`/vehicles/${m.slug}`} className="block">
                    <p className="text-xs text-zinc-500">{m.brand?.name}</p>
                    <p className="text-zinc-100 font-semibold">{m.name}</p>
                    <p className="text-toyota font-mono text-sm mt-1">
                      {m.startingMsrpCad ? `from ${formatCad(asNumber(m.startingMsrpCad)!)}` : "MSRP —"}
                    </p>
                  </Link>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <SectionRow label="Segment" cols={cols} values={models.map((m) => m.segment ?? "—")} />
          <SectionRow label="Body style" cols={cols} values={models.map((m) => m.bodyStyle ?? "—")} />

          <SectionHeader label="Warranty" cols={cols} />
          <SectionRow label="Basic" cols={cols} values={models.map((m) => formatWarranty(m.brand?.basicWarrantyMonths, m.brand?.basicWarrantyKm))} />
          <SectionRow label="Powertrain" cols={cols} values={models.map((m) => formatWarranty(m.brand?.powertrainWarrantyMonths, m.brand?.powertrainWarrantyKm))} />
          <SectionRow label="Hybrid battery" cols={cols} values={models.map((m) => formatWarranty(m.brand?.hybridBatteryMonths, m.brand?.hybridBatteryKm))} />
          <SectionRow label="Corrosion" cols={cols} values={models.map((m) => formatWarranty(m.brand?.corrosionMonths, m.brand?.corrosionKm))} />

          <SectionHeader label="Brand reputation" cols={cols} />
          <SectionRow label="Reliability score" cols={cols} values={models.map((m) => m.brand?.reliabilityScore ? `${asNumber(m.brand.reliabilityScore)!.toFixed(1)} / 10` : "—")} />
          <SectionRow label="Resale value" cols={cols} values={models.map((m) => m.brand?.resaleValueScore ? `${asNumber(m.brand.resaleValueScore)!.toFixed(1)} / 10` : "—")} />

          <SectionHeader label="Ownership cost (latest year)" cols={cols} />
          <SectionRow label="Tire size" cols={cols} values={models.map((m) => m.ownershipCosts[0]?.tireFrontSize ?? "—")} />
          <SectionRow label="Tire set (est.)" cols={cols} values={models.map((m) => m.ownershipCosts[0]?.estTireSetCad ? formatCad(asNumber(m.ownershipCosts[0].estTireSetCad)!) : "—")} />
          <SectionRow label="Oil type" cols={cols} values={models.map((m) => m.ownershipCosts[0]?.oilType ?? "—")} />
          <SectionRow label="Oil change (est.)" cols={cols} values={models.map((m) => m.ownershipCosts[0]?.estOilChangeCad ? formatCad(asNumber(m.ownershipCosts[0].estOilChangeCad)!) : "—")} />
          <SectionRow label="Service interval" cols={cols} values={models.map((m) => m.ownershipCosts[0]?.oilChangeIntervalKm ? `${m.ownershipCosts[0].oilChangeIntervalKm.toLocaleString()} km` : "—")} />
          <SectionRow label="Brake job (front)" cols={cols} values={models.map((m) => m.ownershipCosts[0]?.brakeJobFrontCad ? formatCad(asNumber(m.ownershipCosts[0].brakeJobFrontCad)!) : "—")} />
          <SectionRow label="Dealer labour /hr" cols={cols} values={models.map((m) => m.ownershipCosts[0]?.dealerLabourRateCad ? formatCad(asNumber(m.ownershipCosts[0].dealerLabourRateCad)!) : "—")} />
          <SectionRow label="Free maintenance" cols={cols} values={models.map((m) => m.ownershipCosts[0]?.includedMaintenanceMonths ? `${Math.round(m.ownershipCosts[0].includedMaintenanceMonths / 12)} yr / ${m.ownershipCosts[0].includedMaintenanceKm?.toLocaleString() ?? "—"} km` : "—")} />
          <SectionRow label="5-yr ownership (est.)" cols={cols} values={models.map((m) => m.ownershipCosts[0]?.fiveYearOwnershipCostCad ? formatCad(asNumber(m.ownershipCosts[0].fiveYearOwnershipCostCad)!) : "—")} />

          <SectionHeader label="Top pros" cols={cols} />
          <tr>
            <td className="px-3 py-3 align-top text-xs uppercase tracking-wider text-zinc-500"></td>
            {models.map((m) => (
              <td key={m.id} className="px-4 py-3 bg-ink-900 border-x border-ink-700 align-top">
                <ul className="space-y-1.5 text-xs">
                  {m.prosCons.filter((p) => p.isPro).slice(0, 4).map((p) => (
                    <li key={p.id} className="text-zinc-300"><span className="text-emerald-500 mr-1">+</span>{p.text}</li>
                  ))}
                  {m.prosCons.filter((p) => p.isPro).length === 0 && <li className="text-zinc-600">—</li>}
                </ul>
              </td>
            ))}
          </tr>

          <SectionHeader label="Top cons" cols={cols} />
          <tr>
            <td className="px-3 py-3 align-top text-xs uppercase tracking-wider text-zinc-500"></td>
            {models.map((m) => (
              <td key={m.id} className="px-4 py-3 bg-ink-900 border-x border-ink-700 align-top">
                <ul className="space-y-1.5 text-xs">
                  {m.prosCons.filter((p) => !p.isPro).slice(0, 4).map((p) => (
                    <li key={p.id} className="text-zinc-300"><span className="text-amber-500 mr-1">−</span>{p.text}</li>
                  ))}
                  {m.prosCons.filter((p) => !p.isPro).length === 0 && <li className="text-zinc-600">—</li>}
                </ul>
              </td>
            ))}
          </tr>

          <SectionHeader label="Known issues" cols={cols} />
          <tr>
            <td className="px-3 py-3 align-top text-xs uppercase tracking-wider text-zinc-500"></td>
            {models.map((m) => (
              <td key={m.id} className="px-4 py-3 bg-ink-900 border-x border-ink-700 align-top">
                <ul className="space-y-1.5 text-xs">
                  {m.commonIssues.map((i) => (
                    <li key={i.id} className="text-zinc-300">
                      <span className="text-amber-400 text-[10px] uppercase mr-1.5">{i.severity}</span>
                      {i.title}
                    </li>
                  ))}
                  {m.commonIssues.length === 0 && <li className="text-zinc-500">None on record.</li>}
                </ul>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SectionHeader({ label, cols }: { label: string; cols: number }) {
  return (
    <tr>
      <th className="text-left text-[10px] uppercase tracking-widest text-zinc-500 pt-6 pb-2" colSpan={cols + 1}>
        {label}
      </th>
    </tr>
  );
}

function SectionRow({ label, cols, values }: { label: string; cols: number; values: string[] }) {
  return (
    <tr className="border-t border-ink-700/40">
      <td className="px-3 py-2 text-zinc-500 text-xs">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="px-4 py-2 bg-ink-800/60 border-x border-ink-700 text-zinc-200">{v}</td>
      ))}
      {Array.from({ length: Math.max(0, cols - values.length) }).map((_, i) => <td key={`pad-${i}`}></td>)}
    </tr>
  );
}
