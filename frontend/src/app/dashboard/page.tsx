"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Shell } from "@/components/shell";
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

const STATUS_STYLE: Record<string, string> = {
  Completed: "bg-verdict-pass-soft text-verdict-pass border-verdict-pass/25",
  Error: "bg-verdict-fail-soft text-verdict-fail border-verdict-fail/25",
  Processing: "bg-verdict-hold-soft text-verdict-hold border-verdict-hold/25",
  Queued: "bg-muted text-muted-foreground border-border",
  Watching: "bg-sky-50 text-sky-700 border-sky-200",
};

export default function DashboardHome() {
  const { data: campaigns, isLoading } = useQuery<Campaign[]>({
    queryKey: ["campaigns"],
    queryFn: () => api("/campaigns"),
  });

  return (
    <Shell
      title="Campaigns"
      actions={
        <Link href="/dashboard/campaigns/new" className={buttonVariants()}>
          New campaign
        </Link>
      }
    >
      {isLoading && <p className="text-muted-foreground">Loading…</p>}

      {campaigns && campaigns.length === 0 && (
        <div className="rounded-lg border border-dashed bg-card p-10 text-center">
          <h2 className="font-display text-lg font-semibold">
            No campaigns yet
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Upload a job description and resumes to run your first screening.
          </p>
          <Link
            href="/dashboard/campaigns/new"
            className={`${buttonVariants()} mt-5`}
          >
            Create your first campaign
          </Link>
        </div>
      )}

      {campaigns && campaigns.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => (
            <li key={c.id}>
              <Link
                href={`/dashboard/campaigns/${c.id}`}
                className="flex h-full flex-col justify-between gap-4 rounded-lg border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div>
                  <p className="font-display font-semibold leading-snug">
                    {c.name}
                  </p>
                  {c.created_at && (
                    <p className="data-value mt-1 text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLE[c.status] ?? STATUS_STYLE.Queued
                    }`}
                  >
                    {c.status}
                  </span>
                  <span className="data-value text-xs text-muted-foreground">
                    {c.region ?? "—"} · cut-off {c.threshold}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
