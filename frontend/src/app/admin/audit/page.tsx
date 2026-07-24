"use client";

import { useQuery } from "@tanstack/react-query";

import { UserHeader } from "@/components/user-header";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";

type AuditEntry = {
  id: number;
  created_at: string | null;
  user_email: string | null;
  company_id: number | null;
  action: string;
  detail: Record<string, unknown> | null;
};

function actionVariant(action: string) {
  if (action.startsWith("retention") || action.includes("deleted"))
    return "destructive" as const;
  if (action.includes("gender") || action.includes("approved"))
    return "default" as const;
  return "secondary" as const;
}

function summarize(detail: Record<string, unknown> | null): string {
  if (!detail) return "";
  return Object.entries(detail)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== "any")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export default function AuditPage() {
  const { data: entries, isLoading } = useQuery<AuditEntry[]>({
    queryKey: ["audit"],
    queryFn: () => api("/admin/audit"),
  });

  return (
    <div className="min-h-screen bg-muted/20">
      <UserHeader title="Audit trail" />
      <main className="mx-auto max-w-5xl p-6">
        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {entries && entries.length === 0 && (
          <p className="text-muted-foreground">No audit entries yet.</p>
        )}
        {entries && entries.length > 0 && (
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {e.created_at
                        ? new Date(e.created_at).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {e.user_email ?? "system"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={actionVariant(e.action)}>{e.action}</Badge>
                    </TableCell>
                    <TableCell className="max-w-md text-xs text-muted-foreground">
                      {summarize(e.detail)}
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
