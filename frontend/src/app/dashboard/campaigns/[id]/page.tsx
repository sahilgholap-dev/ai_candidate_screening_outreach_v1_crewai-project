"use client";

import { useQuery } from "@tanstack/react-query";
import { use } from "react";

import { UserHeader } from "@/components/user-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";

type CandidateRow = {
  id: number;
  name: string | null;
  original_filename: string;
  score: number | null;
  recommendation: string | null;
  hard_filter_failed: boolean;
  key_strengths: string | null; // JSON string
  key_gaps: string | null; // JSON string
  needs_info: string | null; // JSON string
  flags: string | null; // JSON string
  rationale: string | null;
};

type CampaignDetail = {
  campaign: {
    id: number;
    name: string;
    status: string;
    threshold: number;
    region: string | null;
  };
  candidates: CandidateRow[];
  processed_count: number;
  total_count: number;
};

function parseList(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function recommendationVariant(rec: string | null) {
  if (!rec) return "secondary" as const;
  if (rec.toLowerCase().includes("shortlist")) return "default" as const;
  if (rec.toLowerCase().includes("maybe")) return "secondary" as const;
  return "destructive" as const;
}

export default function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const { data } = useQuery<CampaignDetail>({
    queryKey: ["campaign", id],
    queryFn: () => api(`/campaigns/${id}`),
    refetchInterval: (query) => {
      const s = query.state.data?.campaign.status;
      return s === "Processing" || s === "Queued" ? 5000 : false;
    },
  });

  const campaign = data?.campaign;
  const processing =
    campaign?.status === "Processing" || campaign?.status === "Queued";

  return (
    <div className="min-h-screen bg-muted/20">
      <UserHeader title={campaign?.name ?? "Campaign"} />
      <main className="mx-auto max-w-5xl space-y-6 p-6">
        {campaign && (
          <div className="flex items-center gap-3">
            <Badge
              variant={
                campaign.status === "Completed"
                  ? "default"
                  : campaign.status === "Error"
                    ? "destructive"
                    : "secondary"
              }
            >
              {campaign.status}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Threshold {campaign.threshold} · Region {campaign.region ?? "—"}
            </span>
            {processing && data && (
              <span className="text-sm text-muted-foreground">
                {data.processed_count}/{data.total_count} candidates evaluated…
              </span>
            )}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Candidates</CardTitle>
          </CardHeader>
          <CardContent>
            {!data && <p className="text-muted-foreground">Loading…</p>}
            {data && data.candidates.length === 0 && (
              <p className="text-muted-foreground">No candidates uploaded.</p>
            )}
            {data && data.candidates.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Candidate</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Recommendation</TableHead>
                    <TableHead>Strengths / gaps</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.candidates.map((c, i) => {
                    const strengths = parseList(c.key_strengths);
                    const gaps = parseList(c.key_gaps);
                    const needsInfo = parseList(c.needs_info);
                    const flags = parseList(c.flags);
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>
                          <div className="font-medium">
                            {c.name ?? c.original_filename}
                          </div>
                          {c.rationale && (
                            <p className="mt-1 max-w-md text-xs text-muted-foreground">
                              {c.rationale}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {c.score ?? "…"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={recommendationVariant(c.recommendation)}>
                            {c.recommendation ?? "Pending"}
                          </Badge>
                          {c.hard_filter_failed && (
                            <Badge variant="destructive" className="ml-1">
                              Hard filter
                            </Badge>
                          )}
                          {needsInfo.length > 0 && (
                            <Badge variant="outline" className="ml-1">
                              Needs info: {needsInfo.join(", ")}
                            </Badge>
                          )}
                          {flags.map((f) => (
                            <Badge key={f} variant="secondary" className="ml-1">
                              {f.replaceAll("_", " ")}
                            </Badge>
                          ))}
                        </TableCell>
                        <TableCell className="max-w-sm">
                          {strengths.length > 0 && (
                            <p className="text-xs">
                              <span className="font-medium text-green-700">+ </span>
                              {strengths.slice(0, 2).join("; ")}
                            </p>
                          )}
                          {gaps.length > 0 && (
                            <p className="text-xs">
                              <span className="font-medium text-red-700">− </span>
                              {gaps.slice(0, 2).join("; ")}
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
