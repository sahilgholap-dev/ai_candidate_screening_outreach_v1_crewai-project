"use client";

import { BAND_META, BAND_ORDER, DisplayBand } from "@/lib/bands";

export function BandStrip({
  counts,
  subLines,
  active,
  onSelect,
}: {
  counts: Record<DisplayBand, number>;
  subLines?: Partial<Record<DisplayBand, string>>;
  active: DisplayBand | null;
  onSelect: (band: DisplayBand | null) => void;
}) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {BAND_ORDER.map((band) => {
        const meta = BAND_META[band];
        const isActive = active === band;
        return (
          <button
            key={band}
            type="button"
            onClick={() => onSelect(isActive ? null : band)}
            className={`relative overflow-hidden rounded-[10px] border bg-card px-4 py-3.5 text-left transition-all hover:-translate-y-px ${
              isActive
                ? "border-foreground shadow-lg"
                : "border-border hover:border-input"
            }`}
          >
            <div className={`absolute inset-x-0 top-0 h-[3px] ${meta.bar}`} />
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">
              {meta.label}
            </div>
            <div className="text-[26px] font-bold leading-[1.1] tracking-tight">
              {counts[band] ?? 0}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {subLines?.[band] ?? meta.desc}
            </div>
          </button>
        );
      })}
    </div>
  );
}
