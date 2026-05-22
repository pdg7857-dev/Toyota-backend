import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Ontario Car DB — 2025 & 2026 model comparison",
  description:
    "Publicly-available data on every 2025 and 2026 car for sale in Ontario: prices, warranties, tire and parts costs, common issues. Toyota and Lexus focus.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-CA">
      <body className="min-h-screen flex flex-col">
        <header className="border-b border-ink-700 bg-ink-800/80 backdrop-blur sticky top-0 z-10">
          <div className="max-w-7xl mx-auto flex items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-toyota font-bold text-xl tracking-tight">Ontario</span>
              <span className="text-zinc-100 font-semibold text-xl">CarDB</span>
              <span className="text-zinc-500 text-xs ml-2 hidden sm:inline">2025 · 2026</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <NavLink href="/">Brands</NavLink>
              <NavLink href="/vehicles">Vehicles</NavLink>
              <NavLink href="/compare">Compare</NavLink>
              <NavLink href="/issues">Issues</NavLink>
            </nav>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-ink-700 text-zinc-500 text-xs">
          <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <p>
              Editorial data compiled from public OEM Canadian sites, Transport Canada recalls,
              Reddit consensus, and dealer pricing. <span className="text-zinc-400">Verify against the OEM site before purchase.</span>
            </p>
            <p>
              Featured brands:{" "}
              <span className="text-toyota font-medium">Toyota</span> &middot;{" "}
              <span className="text-lexus-accent font-medium">Lexus</span>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-md text-zinc-300 hover:text-white hover:bg-ink-700 transition-colors"
    >
      {children}
    </Link>
  );
}
