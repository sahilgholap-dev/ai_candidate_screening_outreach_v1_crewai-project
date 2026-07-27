"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { use, useState } from "react";

import { ScoreTile, verdictFor } from "@/components/score-tile";
import { Shell } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

type Judgments = {
  required_skills: { skill: string; present: boolean; core: boolean }[];
  preferred_skills: { skill: string; present: boolean }[];
  must_haves: { item: string; status: string }[];
  estimated_total_years: number | null;
  education_status: string;
  breakdown: {
    buckets: Record<string, { points: number; cap: number }>;
    total: number;
  } | null;
};

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
  judgments: Judgments | null;
};

type CampaignDetail = {
  campaign: {
    id: number;
    name: string;
    status: string;
    threshold: number;
    region: string | null;
    error_message: string | null;
  };
  candidates: CandidateRow[];
  processed_count: number;
  total_count: number;
};

type Tab = "all" | "shortlist" | "needs_info" | "flagged" | "rejected";

const RAIL: Record<string, string> = {
  pass: "border-l-verdict-pass",
  hold: "border-l-verdict-hold",
  fail: "border-l-verdict-fail",
  none: "border-l-border",
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
        <Textarea
          rows={10}
          className="bg-card"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">SMS draft</Label>
        <Textarea
          rows={2}
          className="bg-card"
          value={sms}
          onChange={(e) => setSms(e.target.value)}
        />
        <p className="data-value text-xs text-muted-foreground">
          {sms.length}/160 characters
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
        {candidate.outreach_approved && <Badge>Approved for sending</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        Messages are drafts only — nothing is ever sent automatically. Export
        the CSV to use approved drafts in your mail tool.
      </p>
    </div>
  );
}

const BUCKET_LABELS: Record<string, string> = {
  required_skills: "Required skills",
  must_haves: "Must-haves",
  experience: "Experience",
  education: "Education",
  preferred_skills: "Preferred skills",
};

function Tick({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? "text-verdict-pass" : "text-verdict-fail"}>
      {ok ? "✓" : "✗"}
    </span>
  );
}

function TickSheet({ judgments }: { judgments: Judgments }) {
  const buckets = judgments.breakdown?.buckets;
  return (
    <div className="space-y-4">
      {buckets && (
        <div>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Score breakdown
          </h4>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            {Object.entries(BUCKET_LABELS).map(([key, label]) => {
              const b = buckets[key];
              if (!b) return null;
              return (
                <div key={key} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="data-value font-medium">
                    {b.points}/{b.cap}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {judgments.required_skills.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Required skills — on resume?
          </h4>
          <ul className="grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2">
            {judgments.required_skills.map((s, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <Tick ok={s.present} />
                <span className={s.present ? "" : "text-muted-foreground"}>
                  {s.skill}
                  {s.core && (
                    <span className="ml-1 rounded bg-primary/10 px-1 text-[10px] font-semibold uppercase text-primary">
                      core
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {judgments.must_haves.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Must-haves
          </h4>
          <ul className="space-y-0.5 text-sm">
            {judgments.must_haves.map((m, i) => (
              <li key={i} className="flex items-start gap-1.5">
                {m.status === "unmet" ? (
                  <Tick ok={false} />
                ) : m.status === "met" ? (
                  <Tick ok={true} />
                ) : (
                  <span className="text-verdict-hold">?</span>
                )}
                <span className={m.status === "met" ? "" : "text-muted-foreground"}>
                  {m.item}
                  {m.status === "unknown" && " (not stated on resume)"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {judgments.preferred_skills.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Preferred skills
          </h4>
          <ul className="grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2">
            {judgments.preferred_skills.map((s, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <Tick ok={s.present} />
                <span className={s.present ? "" : "text-muted-foreground"}>
                  {s.skill}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Experience:{" "}
        <span className="data-value">
          {judgments.estimated_total_years != null
            ? `~${judgments.estimated_total_years} yrs from work history`
            : "no duration evidence on resume"}
        </span>
        {" · "}Education requirement:{" "}
        <span className="data-value">{judgments.education_status}</span>
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
    <div className="space-y-6 border-t bg-muted/40 p-4 sm:p-5">
      {candidate.judgments && !candidate.hard_filter_failed && (
        <TickSheet judgments={candidate.judgments} />
      )}
      <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        {candidate.rationale && (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {candidate.hard_filter_failed ? "Hard-filter evidence" : "Rationale"}
            </h4>
            <p className="text-sm leading-relaxed">{candidate.rationale}</p>
          </div>
        )}
        {strengths.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-verdict-pass">
              Strengths
            </h4>
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
              {strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {gaps.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-verdict-fail">
              Gaps
            </h4>
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
              {gaps.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </div>
        )}
        {needsInfo.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-verdict-hold">
              Verify before proceeding
            </h4>
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
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
  const queryClient = useQueryClient();
  const router = useRouter();

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

  const retry = useMutation({
    mutationFn: () => api(`/campaigns/${id}/retry`, { method: "POST" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["campaign", id] }),
  });

  // Clones the campaign (same JD, requirements, parsed resumes) and queues
  // the copy — this run's results stay intact for side-by-side comparison.
  const rerun = useMutation({
    mutationFn: () =>
      api<{ campaign_id: number }>(`/campaigns/${id}/rerun`, { method: "POST" }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      router.push(`/dashboard/campaigns/${res.campaign_id}`);
    },
  });

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

  const TABS: [Tab, string, number][] = [
    ["all", "All", counts.all],
    ["shortlist", "Shortlisted", counts.shortlist],
    ["needs_info", "Needs info", counts.needs_info],
    ["flagged", "Flagged", counts.flagged],
    ["rejected", "Rejected", counts.rejected],
  ];

  return (
    <Shell
      title={campaign?.name ?? "Campaign"}
      actions={
        campaign && (
          <div className="flex items-center gap-2">
            {(campaign.status === "Completed" || campaign.status === "Error") && (
              <Button
                size="sm"
                variant="outline"
                disabled={rerun.isPending}
                onClick={() => rerun.mutate()}
                title="Clones this campaign (same JD, requirements, and resumes) and runs it again — this run's results are kept for comparison"
              >
                {rerun.isPending ? "Cloning…" : "Run again"}
              </Button>
            )}
            <a
              href={`/api/backend/campaigns/${campaign.id}/export.csv`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Export CSV
            </a>
          </div>
        )
      }
    >
      <div className="space-y-5">
        {campaign && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
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
            <span className="data-value text-muted-foreground">
              cut-off {campaign.threshold} · {campaign.region ?? "—"}
            </span>
            {processing && data && (
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="h-2 w-2 animate-pulse rounded-full bg-verdict-hold" />
                <span className="data-value">
                  {data.processed_count}/{data.total_count}
                </span>
                evaluated
              </span>
            )}
          </div>
        )}

        {campaign?.status === "Error" && (
          <div className="flex flex-col gap-3 rounded-lg border border-verdict-fail/30 bg-verdict-fail-soft p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium text-verdict-fail">
                This run failed before completing.
              </p>
              {campaign.error_message && (
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-verdict-fail/90">
                  {campaign.error_message}
                </pre>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Uploaded resumes and the job description are kept — running
                again re-queues the same campaign.
              </p>
            </div>
            <Button
              size="sm"
              className="shrink-0"
              disabled={retry.isPending}
              onClick={() => retry.mutate()}
            >
              {retry.isPending ? "Re-queuing…" : "Run campaign again"}
            </Button>
          </div>
        )}

        {/* Verdict filter */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {TABS.map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                tab === key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {label}
              <span className="data-value text-xs opacity-70">{count}</span>
            </button>
          ))}
        </div>

        {!data && <p className="text-muted-foreground">Loading…</p>}
        {data && visible.length === 0 && (
          <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No candidates in this view.
          </div>
        )}

        <ul className="space-y-2">
          {visible.map((c) => {
            const verdict = verdictFor(c.recommendation, c.hard_filter_failed);
            const needsInfo = parseList(c.needs_info);
            const flags = parseList(c.flags);
            const open = openId === c.id;
            return (
              <li
                key={c.id}
                className={`overflow-hidden rounded-lg border border-l-3 bg-card ${RAIL[verdict]}`}
              >
                <button
                  className="flex w-full items-center gap-3 p-3 text-left sm:gap-4 sm:p-4"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : c.id)}
                >
                  <ScoreTile
                    score={c.score}
                    verdict={verdict}
                    threshold={campaign?.threshold}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {c.name ?? c.original_filename}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant={recVariant(c.recommendation)}>
                        {c.recommendation ?? "Pending"}
                      </Badge>
                      {c.hard_filter_failed && (
                        <Badge variant="destructive">Hard filter</Badge>
                      )}
                      {needsInfo.length > 0 && (
                        <Badge variant="outline">
                          Needs info ({needsInfo.length})
                        </Badge>
                      )}
                      {flags.map((f) => (
                        <Badge key={f} variant="secondary">
                          {f.replaceAll("_", " ")}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="hidden shrink-0 items-center gap-2 sm:flex">
                    {c.email_draft &&
                      (c.outreach_approved ? (
                        <Badge>Approved</Badge>
                      ) : (
                        <Badge variant="outline">Draft ready</Badge>
                      ))}
                    <span aria-hidden className="text-muted-foreground">
                      {open ? "▾" : "▸"}
                    </span>
                  </div>
                </button>
                {open && campaign && (
                  <CandidateDetail campaignId={campaign.id} candidate={c} />
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Shell>
  );
}
