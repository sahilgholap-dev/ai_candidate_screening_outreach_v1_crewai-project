"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { UserHeader } from "@/components/user-header";
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
    <div className="min-h-screen bg-muted/20">
      <UserHeader title="Companies" />
      <main className="p-6">
        <div className="mb-4 flex justify-end gap-2">
          <Link
            href="/admin/audit"
            className={buttonVariants({ variant: "outline" })}
          >
            Audit trail
          </Link>
          <Link href="/admin/companies/new" className={buttonVariants()}>
            Onboard company
          </Link>
        </div>

        {isLoading && <p className="text-muted-foreground">Loading…</p>}

        {companies && companies.length === 0 && (
          <p className="text-muted-foreground">
            No companies yet. Onboard your first client.
          </p>
        )}

        {companies && companies.length > 0 && (
          <div className="rounded-lg border bg-background">
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
                    <TableCell className="text-right">{c.user_count}</TableCell>
                    <TableCell className="text-right">{c.campaign_count}</TableCell>
                    <TableCell className="text-right font-mono">
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
        )}
      </main>
    </div>
  );
}
