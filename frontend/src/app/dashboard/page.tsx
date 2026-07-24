"use client";

import { useQuery } from "@tanstack/react-query";

import { UserHeader } from "@/components/user-header";

type Campaign = {
  id: number;
  name: string;
  status: string;
  threshold: number;
  created_at: string | null;
};

export default function DashboardHome() {
  const { data: campaigns, isLoading } = useQuery<Campaign[]>({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const res = await fetch("/api/backend/campaigns");
      if (!res.ok) throw new Error("Failed to load campaigns");
      return res.json();
    },
  });

  return (
    <div className="min-h-screen bg-muted/20">
      <UserHeader title="Campaigns" />
      <main className="p-6">
        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {campaigns && campaigns.length === 0 && (
          <p className="text-muted-foreground">
            No campaigns yet. Campaign creation UI arrives in Phase 3.
          </p>
        )}
        {campaigns && campaigns.length > 0 && (
          <ul className="space-y-2">
            {campaigns.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-lg border bg-background px-4 py-3"
              >
                <span className="font-medium">{c.name}</span>
                <span className="text-sm text-muted-foreground">{c.status}</span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
