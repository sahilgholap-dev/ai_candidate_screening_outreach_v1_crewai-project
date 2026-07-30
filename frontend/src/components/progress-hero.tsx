"use client";

// The client's reassurance while a search runs: human-readable status,
// honest progress, and a transparent (non-technical) stage panel.

type Stage = { name: string; detail: string; state: "done" | "active" | "todo" };

export function ProgressHero({
  statusLabel,
  currentLine,
  processed,
  total,
  recommended,
  etaLabel,
  stages,
}: {
  statusLabel: string;
  currentLine: string;
  processed: number;
  total: number;
  recommended: number;
  etaLabel: string | null;
  stages: Stage[];
}) {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="mb-5 rounded-xl border bg-card p-8 text-center shadow-sm">
      <div className="mb-2 text-[13px] uppercase tracking-[1px] text-muted-foreground">
        {statusLabel}
      </div>
      <div className="mb-5 text-[22px] font-semibold">{currentLine}</div>
      <div className="mx-auto mb-3 h-2.5 max-w-[520px] overflow-hidden rounded-full bg-gray-soft">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#10B981] to-[#34D399] transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-5 flex flex-wrap justify-center gap-8 text-[13px] text-muted-foreground">
        <span>
          <b className="font-semibold text-foreground">{processed}</b> of {total}{" "}
          candidates scored
        </span>
        {etaLabel && (
          <span>
            <b className="font-semibold text-foreground">{etaLabel}</b> remaining
          </span>
        )}
        <span>
          <b className="font-semibold text-foreground">{recommended}</b>{" "}
          recommended so far
        </span>
      </div>

      <div className="mt-[26px] grid gap-3 text-left sm:grid-cols-2 lg:grid-cols-4">
        {stages.map((s, i) => (
          <div
            key={s.name}
            className={`rounded-lg border p-3 ${
              s.state === "done"
                ? "border-verdict-pass bg-verdict-pass-soft"
                : s.state === "active"
                  ? "border-band-blue bg-band-blue-soft"
                  : "border-border bg-gray-soft"
            }`}
          >
            <div className="text-[11px] font-semibold text-muted-foreground">
              Step {i + 1}
            </div>
            <div className="mt-[3px] text-[13px] font-semibold">
              {s.name}
              {s.state === "done" ? " ✓" : s.state === "active" ? "…" : ""}
            </div>
            <div className="mt-0.5 text-[11.5px] text-muted-foreground">
              {s.detail}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
