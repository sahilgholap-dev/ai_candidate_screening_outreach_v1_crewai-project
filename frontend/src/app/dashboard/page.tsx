"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { UserHeader } from "@/components/user-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/api";

type Campaign = {
  id: number;
  name: string;
  status: string;
  threshold: number;
  region: string | null;
  created_at: string | null;
};

function statusVariant(status: string) {
  if (status === "Completed") return "default" as const;
  if (status === "Error") return "destructive" as const;
  return "secondary" as const;
}

export default function DashboardHome() {
  const { data: campaigns, isLoading } = useQuery<Campaign[]>({
    queryKey: ["campaigns"],
    queryFn: () => api("/campaigns"),
  });

  return (
    <div className="min-h-screen bg-muted/20">
      <UserHeader title="Campaigns" />
      <main className="p-6">
        <div className="mb-4 flex justify-end">
          <Link href="/dashboard/campaigns/new" className={buttonVariants()}>
            New campaign
          </Link>
        </div>

        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {campaigns && campaigns.length === 0 && (
          <p className="text-muted-foreground">
            No campaigns yet. Create your first one.
          </p>
        )}
        {campaigns && campaigns.length > 0 && (
          <ul className="space-y-2">
            {campaigns.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/dashboard/campaigns/${c.id}`}
                  className="flex items-center justify-between rounded-lg border bg-background px-4 py-3 hover:bg-muted/50"
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="flex items-center gap-3 text-sm text-muted-foreground">
                    {c.region && <span>{c.region}</span>}
                    <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
