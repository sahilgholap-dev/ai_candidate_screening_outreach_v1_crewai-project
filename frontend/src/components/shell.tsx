"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useMe } from "@/components/user-header";

type NavItem = { href: string; label: string };

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-baseline gap-1.5">
      <span className="font-display text-lg font-bold tracking-tight text-sidebar-primary">
        NEXUS
      </span>
      {!compact && (
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-sidebar-foreground/60">
          screening
        </span>
      )}
    </Link>
  );
}

function NavLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active =
          item.href === pathname ||
          (item.href !== "/" && pathname.startsWith(item.href + "/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Shell({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: me } = useMe();
  const [menuOpen, setMenuOpen] = useState(false);

  const isAdmin = me?.role === "platform_admin";
  const items: NavItem[] = isAdmin
    ? [
        { href: "/admin", label: "Companies" },
        { href: "/admin/audit", label: "Audit trail" },
      ]
    : [
        { href: "/dashboard", label: "Campaigns" },
        { href: "/dashboard/campaigns/new", label: "New campaign" },
      ];

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const identity = (
    <div className="flex items-center justify-between gap-2 border-t border-sidebar-border pt-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-sidebar-foreground">
          {me?.full_name ?? me?.email ?? "…"}
        </p>
        <p className="text-xs text-sidebar-foreground/55">
          {isAdmin ? "Platform admin" : "Recruiter"}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        onClick={logout}
      >
        Sign out
      </Button>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between bg-sidebar p-5 lg:flex">
        <div className="space-y-8">
          <Wordmark />
          <NavLinks items={items} pathname={pathname} />
        </div>
        {identity}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between bg-sidebar px-4 py-3 lg:hidden">
          <Wordmark compact />
          <button
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-2"
          >
            <span aria-hidden className="block w-5 text-center leading-none">
              {menuOpen ? "✕" : "☰"}
            </span>
          </button>
        </header>
        {menuOpen && (
          <div className="sticky top-12 z-10 space-y-4 border-b border-sidebar-border bg-sidebar p-4 lg:hidden">
            <NavLinks
              items={items}
              pathname={pathname}
              onNavigate={() => setMenuOpen(false)}
            />
            {identity}
          </div>
        )}

        {/* Page header */}
        <div className="border-b bg-card">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
            <h1 className="font-display text-xl font-semibold sm:text-2xl">
              {title}
            </h1>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
          </div>
        </div>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
