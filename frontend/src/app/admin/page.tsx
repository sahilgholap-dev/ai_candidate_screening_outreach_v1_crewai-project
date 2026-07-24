"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Shell } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, Company, REGION_LABELS } from "@/lib/api";

export default function AdminHome() {
  const { data: companies, isLoading } = useQuery<Company[]>({
    queryKey: ["companies"],
    queryFn: () => api("/admin/companies"),
  });

  return (
    <Shell
      title="Companies"
      actions={
        <Link href="/admin/companies/new" className={buttonVariants()}>
          Onboard company
        </Link>
      }
    >
      {isLoading && <p className="text-muted-foreground">Loading…</p>}

      {companies && companies.length === 0 && (
        <div className="rounded-lg border border-dashed bg-card p-10 text-center">
          <h2 className="font-display text-lg font-semibold">
            No companies yet
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Onboard your first client to create their logins and campaigns.
          </p>
        </div>
      )}

      {companies && companies.length > 0 && (
        <>
          {/* Mobile: cards */}
          <ul className="space-y-3 md:hidden">
            {companies.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/admin/companies/${c.id}`}
                  className="block rounded-lg border bg-card p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display font-semibold">{c.name}</span>
                    <Badge variant={c.is_active ? "default" : "destructive"}>
                      {c.is_active ? "Active" : "Deactivated"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {REGION_LABELS[c.default_region]}
                  </p>
                  <p className="data-value mt-1 text-xs text-muted-foreground">
                    {c.user_count} users · {c.campaign_count} campaigns ·{" "}
                    {c.total_tokens.toLocaleString()} tokens
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead className="text-right">Users</TableHead>
                  <TableHead className="text-right">Campaigns</TableHead>
                  <TableHead className="text-right">LLM tokens</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        href={`/admin/companies/${c.id}`}
                        className="font-medium hover:underline"
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>{REGION_LABELS[c.default_region]}</TableCell>
                    <TableCell className="data-value text-right">
                      {c.user_count}
                    </TableCell>
                    <TableCell className="data-value text-right">
                      {c.campaign_count}
                    </TableCell>
                    <TableCell className="data-value text-right">
                      {c.total_tokens.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.is_active ? "default" : "destructive"}>
                        {c.is_active ? "Active" : "Deactivated"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </Shell>
  );
}
