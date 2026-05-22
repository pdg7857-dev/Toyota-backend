// Small formatting helpers for the comparison UI.

const CAD = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

const NUM = new Intl.NumberFormat("en-CA");

export function formatCad(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const v = typeof n === "object" && "toNumber" in (n as object)
    ? (n as { toNumber: () => number }).toNumber()
    : Number(n);
  if (!Number.isFinite(v)) return "—";
  return CAD.format(v);
}

export function formatKm(n: number | null | undefined, unlimitedSentinel = 999_999_999): string {
  if (n === null || n === undefined) return "—";
  if (n >= unlimitedSentinel) return "Unlimited";
  return `${NUM.format(n)} km`;
}

export function formatWarranty(months?: number | null, km?: number | null): string {
  if (!months && !km) return "—";
  const years = months ? Math.round(months / 12) : null;
  const left = years ? `${years} yr` : `${months} mo`;
  const right = km == null ? "unlimited km" : km >= 999_999_999 ? "unlimited km" : `${NUM.format(km)} km`;
  return `${left} / ${right}`;
}

export function asNumber(d: unknown): number | undefined {
  if (d === null || d === undefined) return undefined;
  if (typeof d === "number") return d;
  if (typeof d === "object" && d && "toNumber" in d) {
    try { return (d as { toNumber: () => number }).toNumber(); } catch { /* ignore */ }
  }
  const n = Number(d);
  return Number.isFinite(n) ? n : undefined;
}
