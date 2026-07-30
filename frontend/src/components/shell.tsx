"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { useMe } from "@/components/user-header";

type NavItem = { href: string; label: string; icon: string; badge?: number };

function Brand() {
  return (
    <div className="mb-4 border-b border-sidebar-border px-[22px] pb-6">
      <div className="text-[11px] font-bold tracking-[2px] text-sidebar-primary">
        NEXUS
      </div>
      <div className="text-[15px] font-semibold tracking-tight text-slate-100">
        Talent Match
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-[1.5px] text-slate-500">
      {children}
    </div>
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
    <nav className="flex flex-col">
      {items.map((item) => {
        const active =
          item.href === pathname ||
          (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`my-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-[9px] text-[13.5px] font-medium transition-colors ${
              active
                ? "bg-sidebar-accent text-white"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-slate-100"
            }`}
          >
            <span className="inline-flex h-[18px] w-[18px] items-center justify-center">
              {item.icon}
            </span>
            {item.label}
            {item.badge !== undefined && item.badge > 0 && (
              <span className="ml-auto rounded-full bg-sidebar-primary px-[7px] py-px text-[10.5px] font-bold text-sidebar-primary-foreground">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function initials(name: string | null | undefined, email: string | undefined) {
  const source = name?.trim() || email || "?";
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function Shell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: me } = useMe();
  const [menuOpen, setMenuOpen] = useState(false);

  const isAdmin = me?.role === "platform_admin";

  const { data: queue } = useQuery<unknown[]>({
    queryKey: ["outreach-queue"],
    queryFn: async () => {
      const res = await fetch("/api/backend/outreach/queue");
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!me && !isAdmin,
    refetchInterval: 30_000,
  });

  const workspaceItems: NavItem[] = [
    { href: "/dashboard/campaigns/new", label: "Start new search", icon: "＋" },
    { href: "/dashboard", label: "Search library", icon: "☰" },
    {
      href: "/dashboard/outreach",
      label: "Outreach queue",
      icon: "✎",
      badge: queue?.length ?? 0,
    },
    { href: "/dashboard/outreach/sent", label: "Sent outreach", icon: "↗" },
  ];
  const settingsItems: NavItem[] = [
    { href: "/dashboard/settings", label: "Workspace settings", icon: "⚙" },
  ];
  const adminItems: NavItem[] = [
    { href: "/admin", label: "Companies", icon: "☰" },
    { href: "/admin/audit", label: "Audit trail", icon: "✓" },
  ];

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const nav = isAdmin ? (
    <>
      <SectionLabel>Platform</SectionLabel>
      <NavLinks
        items={adminItems}
        pathname={pathname}
        onNavigate={() => setMenuOpen(false)}
      />
    </>
  ) : (
    <>
      <SectionLabel>Workspace</SectionLabel>
      <NavLinks
        items={workspaceItems}
        pathname={pathname}
        onNavigate={() => setMenuOpen(false)}
      />
      <div className="mt-5">
        <SectionLabel>Settings</SectionLabel>
        <NavLinks
          items={settingsItems}
          pathname={pathname}
          onNavigate={() => setMenuOpen(false)}
        />
      </div>
    </>
  );

  const userBox = (
    <div className="flex items-center gap-2.5 border-t border-sidebar-border px-[18px] pt-3.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#10B981] to-[#059669] text-[13px] font-semibold text-white">
        {initials(me?.full_name, me?.email)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-slate-100">
          {me?.full_name ?? me?.email ?? "…"}
        </p>
        <p className="truncate text-[11px] text-text-light">
          {isAdmin ? "Platform admin" : "Recruiter"}
        </p>
      </div>
      <button
        onClick={logout}
        title="Sign out"
        className="rounded px-2 py-1 text-[13px] text-text-light hover:bg-sidebar-accent hover:text-slate-100"
      >
        ↩
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar py-[22px] lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto px-3">{nav}</div>
        {userBox}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between bg-sidebar px-4 py-3 lg:hidden">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px] font-bold tracking-[2px] text-sidebar-primary">
              NEXUS
            </span>
            <span className="text-sm font-semibold text-slate-100">
              Talent Match
            </span>
          </div>
          <button
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <span aria-hidden className="block w-5 text-center leading-none">
              {menuOpen ? "✕" : "☰"}
            </span>
          </button>
        </header>
        {menuOpen && (
          <div className="sticky top-12 z-10 space-y-4 border-b border-sidebar-border bg-sidebar p-4 pb-5 lg:hidden">
            {nav}
            {userBox}
          </div>
        )}

        {/* Topbar */}
        <div className="sticky top-0 z-10 border-b border-border bg-white max-lg:static">
          <div className="flex flex-wrap items-center justify-between gap-3 px-8 py-3.5 max-sm:px-4">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
              {subtitle && (
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {subtitle}
                </p>
              )}
            </div>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
          </div>
        </div>

        <main className="w-full max-w-[1200px] flex-1 px-8 pb-16 pt-[26px] max-sm:px-4">
          {children}
        </main>
      </div>
    </div>
  );
}
