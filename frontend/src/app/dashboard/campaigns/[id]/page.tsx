"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useRef, useState } from "react";

import { BandStrip } from "@/components/band-strip";
import { CandidateDrawer } from "@/components/candidate-drawer";
import { FilterChip } from "@/components/filter-chip";
import { ProgressHero } from "@/components/progress-hero";
import { Shell } from "@/components/shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import {
  BAND_META,
  DisplayBand,
  displayBand,
  RECOMMENDED_BANDS,
} from "@/lib/bands";
import {
  CandidateRow,
  candidateMeta,
  signalsFor,
} from "@/lib/candidates";
import { moveBinding } from "@/lib/folder-watch";
import { relTime } from "@/lib/relative-time";
import { MyCompany } from "@/lib/requirements";

type CampaignDetail = {
  campaign: {
    id: number;
    name: string;
    status: string;
    threshold: number;
    region: string | null;
    error_message: string | null;
    intake_mode: "upload" | "folder";
    folder_name: string | null;
    unified_profile: unknown;
    finished_at: string | null;
  };
  candidates: CandidateRow[];
  processed_count: number;
  total_count: number;
};

const RUNNING_STATUSES = new Set(["Watching", "Queued", "Processing"]);

const RESULT_FILTERS = [
  "recommended",
  "not_reviewed",
  "approved",
  "over_budget",
  "flagged",
] as const;
type ResultFilter = (typeof RESULT_FILTERS)[number];

// Rolling (time, processed) samples -> "~N min remaining". Sampling happens in
// an async callback so render stays pure (React Compiler rules).
function useEta(processed: number, total: number, active: boolean) {
  const [eta, setEta] = useState<string | null>(null);
  const samples = useRef<{ t: number; processed: number }[]>([]);

  useEffect(() => {
    const id = setTimeout(() => {
      if (!active) {
        samples.current = [];
        setEta(null);
        return;
      }
      const list = samples.current;
      const last = list[list.length - 1];
      if (!last || last.processed !== processed) {
        list.push({ t: Date.now(), processed });
        if (list.length > 6) list.shift();
      }
      if (list.length >= 2) {
        const first = list[0];
        const newest = list[list.length - 1];
        const done = newest.processed - first.processed;
        if (done > 0) {
          const secPer = (newest.t - first.t) / 1000 / done;
          const remaining = Math.max(0, (total - processed) * secPer);
          setEta(
            remaining < 90 ? "under 2 min" : `~${Math.round(remaining / 60)} min`,
          );
          return;
        }
      }
      setEta(null);
    }, 0);
    return () => clearTimeout(id);
  }, [processed, total, active]);

  return eta;
}

export default function SearchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [bandFilter, setBandFilter] = useState<DisplayBand | null>(null);
  const [chipFilter, setChipFilter] = useState<ResultFilter>("recommended");
  const [search, setSearch] = useState("");

  const { data } = useQuery<CampaignDetail>({
    queryKey: ["campaign", id],
    queryFn: () => api(`/campaigns/${id}`),
    refetchInterval: (query) => {
      const c = query.state.data?.campaign;
      if (!c) return 5000;
      if (c.status === "Processing" || c.status === "Queued") return 5000;
      // Watched-folder searches can go Queued at any time (new file drop)
      return c.intake_mode === "folder" ? 15000 : false;
    },
  });
  const { data: company } = useQuery<MyCompany>({
    queryKey: ["my-company"],
    queryFn: () => api("/my/company"),
  });

  const campaign = data?.campaign;
  const candidates = useMemo(() => data?.candidates ?? [], [data]);
  const running = campaign ? RUNNING_STATUSES.has(campaign.status) : false;

  const bandCounts = useMemo(() => {
    const counts = { ideal: 0, good: 0, not_fit: 0, rejected: 0, unscored: 0 };
    for (const c of candidates) counts[displayBand(c)] += 1;
    return counts;
  }, [candidates]);
  const recommended = bandCounts.ideal + bandCounts.good;
  const dealbreakerCount = candidates.filter((c) => c.hard_filter_failed).length;

  const review = useMutation({
    mutationFn: ({
      candidateId,
      status,
    }: {
      candidateId: number;
      status: CandidateRow["review_status"];
    }) =>
      api(`/campaigns/${id}/candidates/${candidateId}`, {
        method: "PATCH",
        body: JSON.stringify({ review_status: status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign", id] });
      queryClient.invalidateQueries({ queryKey: ["outreach-queue"] });
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });

  const cancel = useMutation({
    mutationFn: () => api(`/campaigns/${id}/cancel`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign", id] });
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });

  const retry = useMutation({
    mutationFn: () => api(`/campaigns/${id}/retry`, { method: "POST" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["campaign", id] }),
  });

  // Clones the search (same JD, requirements, parsed resumes) and queues the
  // copy — this run's results stay intact for side-by-side comparison.
  const rerun = useMutation({
    mutationFn: () =>
      api<{ campaign_id: number }>(`/campaigns/${id}/rerun`, { method: "POST" }),
    onSuccess: async (res) => {
      // A watched folder follows the newest clone; the original stops.
      await moveBinding(Number(id), res.campaign_id);
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      router.push(`/dashboard/campaigns/${res.campaign_id}`);
    },
  });

  // ---------- Progress derivations ----------
  const processed = data?.processed_count ?? 0;
  const total = data?.total_count ?? 0;
  const etaLabel = useEta(processed, total, campaign?.status === "Processing");

  const statusLabel =
    campaign?.status === "Watching"
      ? "Watching folder"
      : campaign?.status === "Queued"
        ? "Queued"
        : "Working";
  const currentLine =
    campaign?.status === "Watching"
      ? "Waiting for the first resumes to appear in the folder"
      : campaign?.status === "Queued"
        ? "In line behind another search — starting shortly"
        : `Scoring candidate ${Math.min(processed + 1, total)} of ${total} against ${company?.name ?? "your"} requirements`;

  const jdRead = Boolean(campaign?.unified_profile) || processed > 0;
  const stages = [
    {
      name: "Reading the JD",
      detail: "Merging the job description with your form answers into one checklist.",
      state: jdRead ? ("done" as const) : campaign?.status === "Processing" ? ("active" as const) : ("todo" as const),
    },
    {
      name: `Parsing ${total || ""} resumes`.trim(),
      detail: "Extracting text and contact details from every file.",
      state:
        processed > 0
          ? ("done" as const)
          : campaign?.status === "Processing" && jdRead
            ? ("active" as const)
            : ("todo" as const),
    },
    {
      name: "Scoring & ranking",
      detail: "Applying dealbreakers and the five-bucket scoring rubric to each candidate.",
      state:
        campaign?.status === "Processing" && processed > 0
          ? ("active" as const)
          : processed === total && total > 0 && !running
            ? ("done" as const)
            : ("todo" as const),
    },
    {
      name: "Drafting outreach",
      detail: "For everyone in the Ideal Match and Good Fit bands, in your company's voice.",
      state: !running && total > 0 ? ("done" as const) : ("todo" as const),
    },
  ];

  // ---------- Results derivations ----------
  const visible = useMemo(() => {
    let rows = candidates.filter((c) => displayBand(c) !== "unscored");
    if (bandFilter) {
      rows = rows.filter((c) => displayBand(c) === bandFilter);
    } else {
      // Chip views never show manually-rejected candidates — they live in
      // their own band card.
      rows = rows.filter((c) => displayBand(c) !== "rejected");
      switch (chipFilter) {
        case "recommended":
          rows = rows.filter((c) => RECOMMENDED_BANDS.includes(c.band));
          break;
        case "not_reviewed":
          rows = rows.filter(
            (c) =>
              RECOMMENDED_BANDS.includes(c.band) && c.review_status === "pending",
          );
          break;
        case "approved":
          rows = rows.filter((c) => c.review_status === "approved");
          break;
        case "over_budget":
          rows = rows.filter((c) => (c.flags ?? "").includes("over_budget"));
          break;
        case "flagged":
          rows = rows.filter(
            (c) =>
              signalsFor(c).length > 0 &&
              RECOMMENDED_BANDS.includes(c.band),
          );
          break;
      }
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (c) =>
          (c.name ?? c.original_filename).toLowerCase().includes(q) ||
          (c.rationale ?? "").toLowerCase().includes(q),
      );
    }
    const order: Record<string, number> = {
      ideal: 0,
      good: 1,
      not_fit: 2,
      rejected: 3,
      unscored: 4,
    };
    return [...rows].sort(
      (a, b) =>
        order[displayBand(a)] - order[displayBand(b)] ||
        (b.score ?? -1) - (a.score ?? -1),
    );
  }, [candidates, bandFilter, chipFilter, search]);

  const drawerCandidate = candidates.find((c) => c.id === drawerId) ?? null;

  const chipLabel: Record<ResultFilter, string> = {
    recommended: `All ${recommended} recommended`,
    not_reviewed: "Not yet reviewed",
    approved: "Approved",
    over_budget: "Over budget",
    flagged: "Flagged",
  };

  // ---------- Render ----------
  const showProgress = running;

  return (
    <Shell
      title={campaign?.name ?? "Search"}
      subtitle={
        showProgress
          ? "Search in progress"
          : campaign
            ? `${total} candidates reviewed · ${recommended} recommended${
                campaign.status === "Completed" && campaign.finished_at
                  ? ` · Completed ${relTime(campaign.finished_at)}`
                  : campaign.status === "Cancelled"
                    ? " · Cancelled"
                    : ""
              }`
            : undefined
      }
      actions={
        campaign && (
          <div className="flex items-center gap-2">
            {showProgress && (
              <Button
                size="sm"
                variant="outline"
                className="border-red-300 text-verdict-fail hover:bg-verdict-fail-soft"
                disabled={cancel.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Cancel this search? Partial results are kept.",
                    )
                  ) {
                    cancel.mutate();
                  }
                }}
              >
                {cancel.isPending ? "Cancelling…" : "Cancel search"}
              </Button>
            )}
            {!showProgress && (
              <>
                {(campaign.status === "Completed" ||
                  campaign.status === "Error") && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={rerun.isPending}
                    onClick={() => rerun.mutate()}
                    title="Clones this search (same JD, requirements, and resumes) and runs it again — this run's results are kept for comparison"
                  >
                    {rerun.isPending ? "Cloning…" : "Run again"}
                  </Button>
                )}
                <a
                  href={`/api/backend/campaigns/${campaign.id}/export.csv`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  ↓ Export to Excel
                </a>
                <Button
                  size="sm"
                  onClick={() => router.push("/dashboard/outreach")}
                >
                  Review outreach drafts →
                </Button>
              </>
            )}
          </div>
        )
      }
    >
      {!data && <p className="text-sm text-muted-foreground">Loading…</p>}

      {campaign?.intake_mode === "folder" && (
        <p className="mb-4 text-[13px] text-muted-foreground">
          📁 Watching “{campaign.folder_name ?? "folder"}”
          {campaign.status === "Watching"
            ? " — waiting for the first resumes to appear in the folder."
            : campaign.status === "Cancelled"
              ? " — watching stopped with the search."
              : " — new resumes in this folder are screened automatically while the app is open."}
        </p>
      )}

      {showProgress && campaign && (
        <ProgressHero
          statusLabel={statusLabel}
          currentLine={currentLine}
          processed={processed}
          total={total}
          recommended={recommended}
          etaLabel={etaLabel}
          stages={stages}
        />
      )}

      {campaign?.status === "Cancelled" && (
        <div className="mb-5 rounded-lg border bg-gray-soft px-4 py-3 text-[13px] text-muted-foreground">
          This search was cancelled — results below are partial.
        </div>
      )}

      {campaign?.status === "Error" && (
        <div className="mb-5 flex flex-col gap-3 rounded-lg border border-red-200 bg-verdict-fail-soft p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-verdict-fail">
              This run failed before completing.
            </p>
            {campaign.error_message && (
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-verdict-fail/90">
                {campaign.error_message}
              </pre>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={retry.isPending}
            onClick={() => retry.mutate()}
          >
            {retry.isPending ? "Re-queuing…" : "Try again"}
          </Button>
        </div>
      )}

      {!showProgress && campaign && candidates.length > 0 && (
        <>
          <BandStrip
            counts={bandCounts}
            subLines={
              dealbreakerCount > 0
                ? {
                    not_fit: `Includes ${dealbreakerCount} dealbreaker rejection${dealbreakerCount === 1 ? "" : "s"}`,
                  }
                : undefined
            }
            active={bandFilter}
            onSelect={setBandFilter}
          />

          <div className="mb-[18px] flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search candidates…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-auto min-w-60 max-w-xs px-3 py-[7px] text-[13px]"
            />
            {RESULT_FILTERS.map((f) => (
              <FilterChip
                key={f}
                active={!bandFilter && chipFilter === f}
                onClick={() => {
                  setBandFilter(null);
                  setChipFilter(f);
                }}
              >
                {chipLabel[f]}
              </FilterChip>
            ))}
          </div>

          <div className="overflow-hidden rounded-[10px] border bg-card shadow-sm">
            <div className="grid cursor-default grid-cols-[40px_90px_1fr_1fr_130px_100px] items-center gap-3.5 border-b bg-[#FAFBFC] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground max-lg:hidden">
              <div>#</div>
              <div>Band</div>
              <div>Candidate</div>
              <div>Why they match</div>
              <div>Signals</div>
              <div className="text-right">Actions</div>
            </div>
            {visible.map((c, i) => {
              const meta = BAND_META[displayBand(c)];
              const signals = signalsFor(c);
              return (
                <div
                  key={c.id}
                  onClick={() => setDrawerId(c.id)}
                  className="grid cursor-pointer grid-cols-[40px_90px_1fr_1fr_130px_100px] items-center gap-3.5 border-b px-4 py-3.5 transition-colors last:border-b-0 hover:bg-[#FAFBFC] max-lg:grid-cols-[40px_90px_1fr_100px]"
                >
                  <div className="text-center text-sm font-semibold text-muted-foreground">
                    {i + 1}
                  </div>
                  <div
                    className={`rounded px-2 py-[3px] text-center text-[11px] font-semibold ${meta.tag}`}
                  >
                    {meta.label.split(" ")[0]}
                  </div>
                  <div className="min-w-0">
                    <div className="mb-0.5 truncate text-sm font-semibold">
                      {c.name ?? c.original_filename}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {candidateMeta(c)}
                    </div>
                  </div>
                  <div className="line-clamp-2 text-[12.5px] text-muted-foreground max-lg:hidden">
                    {c.rationale ?? "—"}
                  </div>
                  <div className="space-y-0.5 max-lg:hidden">
                    {signals.map((s) => (
                      <div
                        key={s.text}
                        className={`text-[11.5px] font-semibold ${
                          s.tone === "positive"
                            ? "text-verdict-pass"
                            : "text-verdict-hold"
                        }`}
                      >
                        {s.text}
                      </div>
                    ))}
                  </div>
                  <div
                    className="flex justify-end gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      title={
                        c.review_status === "approved" ? "Approved" : "Approve"
                      }
                      onClick={() =>
                        review.mutate({
                          candidateId: c.id,
                          status:
                            c.review_status === "approved"
                              ? "pending"
                              : "approved",
                        })
                      }
                      className={`flex h-[30px] w-[30px] items-center justify-center rounded-md border text-sm transition-colors ${
                        c.review_status === "approved"
                          ? "border-verdict-pass bg-verdict-pass text-white"
                          : "border-border bg-white text-verdict-pass hover:border-verdict-pass hover:bg-verdict-pass-soft"
                      }`}
                    >
                      ✓
                    </button>
                    <button
                      title={
                        c.review_status === "rejected" ? "Rejected" : "Reject"
                      }
                      onClick={() =>
                        review.mutate({
                          candidateId: c.id,
                          status:
                            c.review_status === "rejected"
                              ? "pending"
                              : "rejected",
                        })
                      }
                      className={`flex h-[30px] w-[30px] items-center justify-center rounded-md border text-sm transition-colors ${
                        c.review_status === "rejected"
                          ? "border-verdict-fail bg-verdict-fail text-white"
                          : "border-border bg-white text-muted-foreground hover:border-verdict-fail hover:bg-verdict-fail-soft hover:text-verdict-fail"
                      }`}
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
            {visible.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No candidates match this view.
              </div>
            )}
          </div>
        </>
      )}

      {!showProgress && campaign && candidates.length === 0 && (
        <div className="rounded-[10px] border bg-card p-10 text-center text-sm text-muted-foreground shadow-sm">
          No candidates in this search.
        </div>
      )}

      <CandidateDrawer
        candidate={drawerCandidate}
        onClose={() => setDrawerId(null)}
        onReview={(status) => {
          if (drawerCandidate) {
            review.mutate({ candidateId: drawerCandidate.id, status });
            setDrawerId(null);
          }
        }}
        onApproveForOutreach={() => {
          if (drawerCandidate) {
            review.mutate(
              { candidateId: drawerCandidate.id, status: "approved" },
              { onSuccess: () => router.push("/dashboard/outreach") },
            );
            setDrawerId(null);
          }
        }}
      />
    </Shell>
  );
}
