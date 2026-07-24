"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, use, useState } from "react";

import { UserHeader } from "@/components/user-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

type CandidateRow = {
  id: number;
  name: string | null;
  original_filename: string;
  score: number | null;
  recommendation: string | null;
  hard_filter_failed: boolean;
  key_strengths: string | null;
  key_gaps: string | null;
  needs_info: string | null;
  flags: string | null;
  rationale: string | null;
  email_draft: string | null;
  sms_draft: string | null;
  outreach_approved: boolean;
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

type Tab = "all" | "shortlist" | "needs_info" | "flagged" | "rejected";

function parseList(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function recVariant(rec: string | null) {
  if (!rec) return "secondary" as const;
  const r = rec.toLowerCase();
  if (r.includes("shortlist")) return "default" as const;
  if (r.includes("maybe") || r.includes("duplicate")) return "secondary" as const;
  return "destructive" as const;
}

function OutreachEditor({
  campaignId,
  candidate,
}: {
  campaignId: number;
  candidate: CandidateRow;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState(candidate.email_draft ?? "");
  const [sms, setSms] = useState(candidate.sms_draft ?? "");

  const save = useMutation({
    mutationFn: (payload: object) =>
      api(`/campaigns/${campaignId}/candidates/${candidate.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["campaign", String(campaignId)] }),
  });

  const dirty =
    email !== (candidate.email_draft ?? "") || sms !== (candidate.sms_draft ?? "");

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Email draft</Label>
        <Textarea rows={10} value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">SMS draft</Label>
        <Textarea rows={2} value={sms} onChange={(e) => setSms(e.target.value)} />
        <p className="text-xs text-muted-foreground">{sms.length}/160 characters</p>
      </div>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ email_draft: email, sms_draft: sms })}
        >
          {save.isPending ? "Saving…" : "Save drafts"}
        </Button>
        <Button
          size="sm"
          variant={candidate.outreach_approved ? "secondary" : "default"}
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              dirty
                ? {
                    email_draft: email,
                    sms_draft: sms,
                    outreach_approved: !candidate.outreach_approved,
                  }
                : { outreach_approved: !candidate.outreach_approved },
            )
          }
        >
          {candidate.outreach_approved ? "Withdraw approval" : "Approve outreach"}
        </Button>
        {candidate.outreach_approved && (
          <Badge variant="default">Approved for sending</Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Messages are drafts only — nothing is ever sent automatically. Export
        the CSV to use approved drafts in your mail tool.
      </p>
    </div>
  );
}

function CandidateDetail({
  campaignId,
  candidate,
}: {
  campaignId: number;
  candidate: CandidateRow;
}) {
  const strengths = parseList(candidate.key_strengths);
  const gaps = parseList(candidate.key_gaps);
  const needsInfo = parseList(candidate.needs_info);
  const isShortlisted = (candidate.recommendation ?? "")
    .toLowerCase()
    .includes("shortlist");

  return (
    <div className="grid gap-6 bg-muted/30 p-4 lg:grid-cols-2">
      <div className="space-y-4">
        {candidate.rationale && (
          <div>
            <h4 className="mb-1 text-sm font-medium">
              {candidate.hard_filter_failed ? "Hard-filter evidence" : "Rationale"}
            </h4>
            <p className="text-sm text-muted-foreground">{candidate.rationale}</p>
          </div>
        )}
        {strengths.length > 0 && (
          <div>
            <h4 className="mb-1 text-sm font-medium text-green-700">Strengths</h4>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {gaps.length > 0 && (
          <div>
            <h4 className="mb-1 text-sm font-medium text-red-700">Gaps</h4>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {gaps.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </div>
        )}
        {needsInfo.length > 0 && (
          <div>
            <h4 className="mb-1 text-sm font-medium text-amber-700">
              Needs verification before proceeding
            </h4>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {needsInfo.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div>
        {isShortlisted ? (
          <OutreachEditor campaignId={campaignId} candidate={candidate} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Outreach drafts are prepared for shortlisted candidates only.
          </p>
        )}
      </div>
    </div>
  );
}

export default function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [tab, setTab] = useState<Tab>("all");
  const [openId, setOpenId] = useState<number | null>(null);

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

  const counts = {
    all: data?.candidates.length ?? 0,
    shortlist:
      data?.candidates.filter((c) =>
        (c.recommendation ?? "").toLowerCase().includes("shortlist"),
      ).length ?? 0,
    needs_info:
      data?.candidates.filter((c) => parseList(c.needs_info).length > 0).length ?? 0,
    flagged:
      data?.candidates.filter((c) => parseList(c.flags).length > 0).length ?? 0,
    rejected:
      data?.candidates.filter((c) =>
        (c.recommendation ?? "").toLowerCase().includes("reject"),
      ).length ?? 0,
  };

  const visible = (data?.candidates ?? []).filter((c) => {
    const rec = (c.recommendation ?? "").toLowerCase();
    switch (tab) {
      case "shortlist":
        return rec.includes("shortlist");
      case "needs_info":
        return parseList(c.needs_info).length > 0;
      case "flagged":
        return parseList(c.flags).length > 0;
      case "rejected":
        return rec.includes("reject");
      default:
        return true;
    }
  });

  const TABS: [Tab, string][] = [
    ["all", `All (${counts.all})`],
    ["shortlist", `Shortlisted (${counts.shortlist})`],
    ["needs_info", `Needs info (${counts.needs_info})`],
    ["flagged", `Flagged (${counts.flagged})`],
    ["rejected", `Rejected (${counts.rejected})`],
  ];

  return (
    <div className="min-h-screen bg-muted/20">
      <UserHeader title={campaign?.name ?? "Campaign"} />
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        {campaign && (
          <div className="flex flex-wrap items-center justify-between gap-3">
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
                  {data.processed_count}/{data.total_count} evaluated…
                </span>
              )}
            </div>
            <a
              href={`/api/backend/campaigns/${campaign.id}/export.csv`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Export CSV
            </a>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Candidates</CardTitle>
            <div className="mt-2 flex flex-wrap gap-2">
              {TABS.map(([key, label]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={tab === key ? "default" : "outline"}
                  onClick={() => setTab(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {!data && <p className="text-muted-foreground">Loading…</p>}
            {data && visible.length === 0 && (
              <p className="text-muted-foreground">No candidates in this view.</p>
            )}
            {data && visible.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Candidate</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Recommendation</TableHead>
                    <TableHead>Review markers</TableHead>
                    <TableHead className="text-right">Outreach</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((c) => {
                    const needsInfo = parseList(c.needs_info);
                    const flags = parseList(c.flags);
                    const open = openId === c.id;
                    return (
                      <Fragment key={c.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => setOpenId(open ? null : c.id)}
                        >
                          <TableCell>
                            <span className="font-medium">
                              {c.name ?? c.original_filename}
                            </span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {open ? "▾" : "▸"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {c.score ?? "…"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={recVariant(c.recommendation)}>
                              {c.recommendation ?? "Pending"}
                            </Badge>
                            {c.hard_filter_failed && (
                              <Badge variant="destructive" className="ml-1">
                                Hard filter
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {needsInfo.length > 0 && (
                              <Badge variant="outline" className="mr-1">
                                Needs info ({needsInfo.length})
                              </Badge>
                            )}
                            {flags.map((f) => (
                              <Badge key={f} variant="secondary" className="mr-1">
                                {f.replaceAll("_", " ")}
                              </Badge>
                            ))}
                          </TableCell>
                          <TableCell className="text-right">
                            {c.email_draft &&
                              (c.outreach_approved ? (
                                <Badge>Approved</Badge>
                              ) : (
                                <Badge variant="outline">Draft ready</Badge>
                              ))}
                          </TableCell>
                        </TableRow>
                        {open && (
                          <TableRow>
                            <TableCell colSpan={5} className="p-0">
                              <CandidateDetail
                                campaignId={campaign!.id}
                                candidate={c}
                              />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
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
