// Shared candidate row shape + helpers for the results view and drawer.

import { Band } from "@/lib/bands";

export type Judgments = {
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

export type CandidateRow = {
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
  review_status: "pending" | "approved" | "rejected" | "later";
  sent_at: string | null;
  band: Band;
  judgments: Judgments | null;
};

export function parseList(value: string | null): string[] {
  if (!value) return [];
  try {
    const items = JSON.parse(value);
    return Array.isArray(items) ? items.map(String) : [];
  } catch {
    return [];
  }
}

export type Signal = { text: string; tone: "positive" | "warn" };

export function signalsFor(c: CandidateRow): Signal[] {
  const flags = parseList(c.flags);
  const signals: Signal[] = [];
  if (flags.includes("culture_match"))
    signals.push({ text: "◆ Strong culture match", tone: "positive" });
  if (flags.includes("over_budget"))
    signals.push({ text: "£ Over budget", tone: "warn" });
  if (flags.includes("culture_concern"))
    signals.push({ text: "Culture concern", tone: "warn" });
  if (parseList(c.needs_info).length > 0)
    signals.push({ text: "Needs info", tone: "warn" });
  return signals;
}

export function candidateMeta(c: CandidateRow): string {
  const parts: string[] = [];
  const years = c.judgments?.estimated_total_years;
  if (years != null) parts.push(`${years} years`);
  parts.push(c.original_filename);
  return parts.join(" · ");
}

// The five rubric buckets, in display order, with client-facing labels.
export const BUCKET_LABELS: [string, string][] = [
  ["required_skills", "Required skills match"],
  ["must_haves", "Hard requirements met"],
  ["experience", "Experience quality"],
  ["education", "Education"],
  ["preferred_skills", "Nice-to-haves"],
];
