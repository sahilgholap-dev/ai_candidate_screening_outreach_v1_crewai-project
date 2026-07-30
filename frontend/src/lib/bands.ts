// Fit bands — the client-facing language for screening outcomes.
// Mirrors backend/src/ai_candidate_screening_outreach/bands.py.

export type Band = "ideal" | "good" | "not_fit" | "unscored";

// What the results view actually groups by: the screening band, except that a
// manual recruiter rejection overrides it and shows as its own "Rejected" group.
export type DisplayBand = Band | "rejected";

export function displayBand(c: {
  band: Band;
  review_status: string;
}): DisplayBand {
  return c.review_status === "rejected" && c.band !== "unscored"
    ? "rejected"
    : c.band;
}

export const BAND_ORDER: DisplayBand[] = ["ideal", "good", "not_fit", "rejected"];

export const BAND_META: Record<
  DisplayBand,
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
    desc: "Just below the bar — worth reviewing",
  },
  not_fit: {
    label: "Not a Fit",
    tag: "bg-gray-soft text-muted-foreground",
    bar: "bg-text-light",
    desc: "Didn't meet the requirements",
  },
  rejected: {
    label: "Rejected",
    tag: "bg-verdict-fail-soft text-verdict-fail",
    bar: "bg-verdict-fail",
    desc: "Manually rejected by your team",
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
  counts?: { pending_review: number };
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
      // counts may be absent in a stale client cache — never crash the list
      return (row.counts?.pending_review ?? 0) > 0
        ? { kind: "review", label: "Awaiting review" }
        : { kind: "complete", label: "Completed" };
  }
}
