"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FilterChip } from "@/components/filter-chip";
import { Shell } from "@/components/shell";
import { StatusDot } from "@/components/status-dot";
import { buttonVariants } from "@/components/ui/button";
import { api, SearchRow } from "@/lib/api";
import { libraryStatus } from "@/lib/bands";
import { relTime } from "@/lib/relative-time";
import { MyCompany } from "@/lib/requirements";

const FILTERS = [
  "All searches",
  "Active",
  "Awaiting review",
  "Completed",
  "Cancelled",
] as const;
type Filter = (typeof FILTERS)[number];

function matchesFilter(row: SearchRow, filter: Filter): boolean {
  const { kind } = libraryStatus(row);
  switch (filter) {
    case "Active":
      return kind === "running";
    case "Awaiting review":
      return kind === "review";
    case "Completed":
      return kind === "complete" || kind === "review";
    case "Cancelled":
      return kind === "cancelled";
    default:
      return true;
  }
}

export default function SearchLibrary() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("All searches");

  const { data: rows, isLoading } = useQuery<SearchRow[]>({
    queryKey: ["campaigns"],
    queryFn: () => api("/campaigns"),
    refetchInterval: 15_000,
  });
  const { data: company } = useQuery<MyCompany>({
    queryKey: ["my-company"],
    queryFn: () => api("/my/company"),
  });

  const visible = (rows ?? []).filter((r) => matchesFilter(r, filter));

  return (
    <Shell
      title="Search library"
      subtitle={
        company ? `All talent searches for ${company.name}` : "All talent searches"
      }
      actions={
        <Link href="/dashboard/campaigns/new" className={buttonVariants()}>
          ＋ Start new search
        </Link>
      }
    >
      <div className="mb-[18px] flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <FilterChip key={f} active={filter === f} onClick={() => setFilter(f)}>
            {f}
          </FilterChip>
        ))}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {rows && rows.length === 0 && (
        <div className="rounded-[10px] border bg-card p-10 text-center shadow-sm">
          <h2 className="text-[15px] font-semibold">No searches yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Start your first search — upload a job description and we&apos;ll
            find the matches.
          </p>
          <Link
            href="/dashboard/campaigns/new"
            className={`${buttonVariants()} mt-5`}
          >
            ＋ Start new search
          </Link>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-[10px] border bg-card shadow-sm">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b bg-[#FAFBFC]">
                {[
                  "Search name",
                  "Role",
                  "Status",
                  "Candidates reviewed",
                  "Recommended",
                  "Last activity",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const status = libraryStatus(r);
                return (
                  <tr
                    key={r.id}
                    onClick={() => router.push(`/dashboard/campaigns/${r.id}`)}
                    className="cursor-pointer border-b last:border-b-0 hover:bg-[#FAFBFC]"
                  >
                    <td className="px-4 py-3.5 text-[13.5px] font-semibold">
                      {r.name}
                    </td>
                    <td className="px-4 py-3.5 text-[13.5px]">
                      {r.role_title ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-[13.5px]">
                      <StatusDot kind={status.kind} />
                      {status.label}
                    </td>
                    <td className="px-4 py-3.5 text-[13.5px]">
                      {r.counts.total > 0
                        ? `${r.counts.processed} of ${r.counts.total}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3.5 text-[13.5px]">
                      {r.counts.processed > 0 ? (
                        <>
                          {r.counts.recommended}
                          {r.counts.approved > 0 && (
                            <span className="text-muted-foreground">
                              {" "}
                              · {r.counts.approved} approved
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-[13.5px] text-muted-foreground">
                      {relTime(r.finished_at ?? r.created_at)}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    No searches match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
