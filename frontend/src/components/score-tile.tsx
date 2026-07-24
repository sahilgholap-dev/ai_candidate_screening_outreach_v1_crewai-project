"use client";

/**
 * The signature element: a squared mono numeral tinted by verdict, with a
 * hairline threshold tick. Every candidate leads with one — the score IS the
 * product of the screening instrument.
 */

export type Verdict = "pass" | "hold" | "fail" | "none";

export function verdictFor(
  recommendation: string | null,
  hardFilterFailed: boolean,
): Verdict {
  if (hardFilterFailed) return "fail";
  const r = (recommendation ?? "").toLowerCase();
  if (r.includes("shortlist")) return "pass";
  if (r.includes("maybe") || r.includes("duplicate")) return "hold";
  if (r.includes("reject")) return "fail";
  return "none";
}

const TILE_STYLES: Record<Verdict, string> = {
  pass: "bg-verdict-pass-soft text-verdict-pass border-verdict-pass/25",
  hold: "bg-verdict-hold-soft text-verdict-hold border-verdict-hold/25",
  fail: "bg-verdict-fail-soft text-verdict-fail border-verdict-fail/25",
  none: "bg-muted text-muted-foreground border-border",
};

export function ScoreTile({
  score,
  verdict,
  threshold,
}: {
  score: number | null;
  verdict: Verdict;
  threshold?: number;
}) {
  const aboveThreshold =
    score !== null && threshold !== undefined && score >= threshold;
  return (
    <div
      className={`relative flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-md border ${TILE_STYLES[verdict]}`}
      title={
        score === null
          ? "Not scored"
          : threshold !== undefined
            ? `Score ${score} — threshold ${threshold}`
            : `Score ${score}`
      }
    >
      <span className="data-value text-lg font-semibold leading-none">
        {score ?? "–"}
      </span>
      {threshold !== undefined && score !== null && (
        <span
          aria-hidden
          className={`absolute inset-x-1.5 bottom-1 h-0.5 rounded-full ${
            aboveThreshold ? "bg-verdict-pass" : "bg-current opacity-30"
          }`}
        />
      )}
    </div>
  );
}
