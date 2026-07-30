// Fit bands — the client-facing language for screening outcomes.
// Mirrors backend/src/ai_candidate_screening_outreach/bands.py.

export type Band = "ideal" | "good" | "moderate" | "not_fit" | "unscored";

export const BAND_ORDER: Band[] = ["ideal", "good", "moderate", "not_fit"];

export const BAND_META: Record<
  Band,
  { label: string; tag: string; bar: string; desc: string }
> = {
  ideal: {
    label: "Ideal Match",
    tag: "bg-verdict-pass-soft text-emerald-900",
    bar: "bg-verdict-pass",
    desc: "Meets essentially every requirement",
  },
  good: {
    label: "Good Fit",
    tag: "bg-band-blue-soft text-blue-900",
    bar: "bg-band-blue",
    desc: "Meets the bar with minor gaps",
  },
  moderate: {
    label: "Moderate Fit",
    tag: "bg-verdict-hold-soft text-amber-900",
    bar: "bg-verdict-hold",
    desc: "Just below the bar — worth reviewing",
  },
  not_fit: {
    label: "Not a Fit",
    tag: "bg-gray-soft text-muted-foreground",
    bar: "bg-text-light",
    desc: "Didn't meet the requirements",
  },
  unscored: {
    label: "Pending",
    tag: "bg-gray-soft text-muted-foreground",
    bar: "bg-text-light",
    desc: "Not yet scored",
  },
};

export const RECOMMENDED_BANDS: Band[] = ["ideal", "good"];

export type LibraryStatusKind =
  | "complete"
  | "running"
  | "review"
  | "cancelled"
  | "error";

export function libraryStatus(row: {
  status: string;
  counts: { pending_review: number };
}): { kind: LibraryStatusKind; label: string } {
  switch (row.status) {
    case "Error":
      return { kind: "error", label: "Error" };
    case "Cancelled":
      return { kind: "cancelled", label: "Cancelled" };
    case "Watching":
      return { kind: "running", label: "Watching folder" };
    case "Queued":
    case "Processing":
      return { kind: "running", label: "Running" };
    default:
      return row.counts.pending_review > 0
        ? { kind: "review", label: "Awaiting review" }
        : { kind: "complete", label: "Completed" };
  }
}
