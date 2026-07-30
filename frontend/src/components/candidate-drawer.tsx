"use client";

// Right slide-in with the full story behind a candidate's band: the numeric
// score, the rubric arithmetic, and evidence-grounded strengths/gaps.

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { BAND_META, displayBand } from "@/lib/bands";
import {
  BUCKET_LABELS,
  CandidateRow,
  candidateMeta,
  parseList,
} from "@/lib/candidates";

function bucketJustification(c: CandidateRow, bucket: string): string {
  const j = c.judgments;
  if (!j) return "";
  if (bucket === "required_skills") {
    return j.required_skills
      .map((s) => `${s.skill} ${s.present ? "✓" : "✗"}`)
      .join(" · ");
  }
  if (bucket === "preferred_skills") {
    return j.preferred_skills
      .map((s) => `${s.skill} ${s.present ? "✓" : "✗"}`)
      .join(" · ");
  }
  if (bucket === "must_haves") {
    if (j.must_haves.length === 0) return "No extra hard requirements set.";
    return j.must_haves
      .map(
        (m) =>
          `${m.item} ${m.status === "met" ? "✓" : m.status === "unmet" ? "✗" : "(not stated)"}`,
      )
      .join(" · ");
  }
  if (bucket === "experience") {
    return j.estimated_total_years != null
      ? `${j.estimated_total_years} years of career evidence on the resume.`
      : "Career length not stated on the resume.";
  }
  if (bucket === "education") {
    return j.education_status === "met"
      ? "Education requirement satisfied."
      : j.education_status === "unmet"
        ? "Education requirement not met."
        : "No education requirement, or not stated — full points never depend on this alone.";
  }
  return "";
}

export function CandidateDrawer({
  candidate,
  onClose,
  onReview,
  onApproveForOutreach,
}: {
  candidate: CandidateRow | null;
  onClose: () => void;
  onReview: (status: "rejected" | "later") => void;
  onApproveForOutreach: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const open = candidate !== null;
  const meta = candidate ? BAND_META[displayBand(candidate)] : null;
  const buckets = candidate?.judgments?.breakdown?.buckets ?? null;
  const strengths = candidate ? parseList(candidate.key_strengths) : [];
  const gaps = candidate ? parseList(candidate.key_gaps) : [];
  const needsInfo = candidate ? parseList(candidate.needs_info) : [];

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[100] bg-[rgba(15,23,42,0.4)] transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        className={`fixed inset-y-0 right-0 z-[101] flex w-[560px] max-w-[90vw] flex-col bg-white shadow-[-10px_0_30px_rgba(0,0,0,0.15)] transition-transform duration-250 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {candidate && meta && (
          <>
            <div className="border-b px-[26px] py-[22px]">
              <button
                onClick={onClose}
                className="absolute right-5 top-5 flex h-[30px] w-[30px] items-center justify-center rounded-md border bg-white text-base text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
              <span
                className={`mb-2.5 inline-block rounded px-2.5 py-1 text-xs font-bold uppercase tracking-[0.5px] ${meta.tag}`}
              >
                {meta.label}
              </span>
              <div className="text-[22px] font-bold tracking-tight">
                {candidate.name ?? candidate.original_filename}
              </div>
              <div className="text-[13px] text-muted-foreground">
                {candidateMeta(candidate)}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-[26px] py-[22px]">
              <div className="mb-[22px] flex items-baseline gap-5 rounded-[10px] bg-gray-soft px-[18px] py-4">
                <div>
                  <div className="text-[44px] font-bold tracking-[-1px]">
                    {candidate.score ?? "—"}
                    <span className="text-xl font-medium text-text-light">
                      /100
                    </span>
                  </div>
                  <div className="text-[12.5px] text-muted-foreground">
                    Overall match score
                  </div>
                </div>
                <div className="flex-1 border-l border-input pl-4">
                  <div className="text-[13px] font-semibold">
                    Why this score
                  </div>
                  <div className="mt-1 text-[12.5px] text-muted-foreground">
                    {candidate.rationale ?? "No rationale recorded."}
                  </div>
                </div>
              </div>

              {needsInfo.length > 0 && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-verdict-hold-soft px-4 py-3 text-[12.5px] text-amber-900">
                  Couldn&apos;t verify from the resume: {needsInfo.join(", ")} —
                  worth checking on a call. Never auto-rejected for this.
                </div>
              )}

              {buckets && (
                <>
                  <div className="mb-2.5 mt-5 text-[13px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">
                    How the score was reached
                  </div>
                  <div>
                    {BUCKET_LABELS.filter(([key]) => buckets[key]).map(
                      ([key, label]) => (
                        <div
                          key={key}
                          className="grid grid-cols-[1fr_auto] items-center gap-3 border-b py-2 text-[13px]"
                        >
                          <div>
                            <div>{label}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {bucketJustification(candidate, key)}
                            </div>
                          </div>
                          <div className="whitespace-nowrap font-semibold tabular-nums">
                            {buckets[key].points} / {buckets[key].cap}
                          </div>
                        </div>
                      ),
                    )}
                    <div className="mt-1 grid grid-cols-[1fr_auto] items-center gap-3 border-t-2 border-foreground py-3 text-[13px] font-semibold">
                      <div>
                        Total
                        <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                          {BUCKET_LABELS.filter(([key]) => buckets[key])
                            .map(([key]) => buckets[key].points)
                            .join(" + ")}{" "}
                          = {candidate.judgments?.breakdown?.total ?? candidate.score}{" "}
                          · compliance check passed · no protected attributes
                          referenced
                        </div>
                      </div>
                      <div className="whitespace-nowrap tabular-nums">
                        {candidate.judgments?.breakdown?.total ?? candidate.score}{" "}
                        / 100
                      </div>
                    </div>
                  </div>
                </>
              )}

              {strengths.length > 0 && (
                <>
                  <div className="mb-2.5 mt-5 text-[13px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">
                    Strengths that matched your ask
                  </div>
                  {strengths.map((s, i) => (
                    <div
                      key={i}
                      className="mb-1.5 flex items-start gap-2.5 rounded-md bg-verdict-pass-soft px-3 py-2.5 text-[13px] text-emerald-900"
                    >
                      <span className="shrink-0 font-bold text-verdict-pass">
                        ✓
                      </span>
                      <span>{s}</span>
                    </div>
                  ))}
                </>
              )}

              {gaps.length > 0 && (
                <>
                  <div className="mb-2.5 mt-5 text-[13px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">
                    Gaps you might weigh
                  </div>
                  {gaps.map((g, i) => (
                    <div
                      key={i}
                      className="mb-1.5 flex items-start gap-2.5 rounded-md bg-gray-soft px-3 py-2.5 text-[13px]"
                    >
                      <span className="shrink-0 font-bold text-muted-foreground">
                        –
                      </span>
                      <span>{g}</span>
                    </div>
                  ))}
                </>
              )}
            </div>

            <div className="flex gap-2.5 border-t bg-[#FAFBFC] px-[26px] py-[18px]">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => onReview("rejected")}
              >
                Reject
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => onReview("later")}
              >
                Mark for later
              </Button>
              <Button className="flex-[2]" onClick={onApproveForOutreach}>
                Approve for outreach →
              </Button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
