"use client";

import { useState } from "react";

// Collapsible requirements section with a mode pill on the right.
// Pill semantics: hard = can rule candidates out, pref = shapes ranking,
// flag = surfaced but never rejects, off = not evaluated.

const PILL_STYLE: Record<string, string> = {
  hard: "border-red-300 bg-verdict-fail-soft text-verdict-fail",
  pref: "border-blue-200 bg-band-blue-soft text-band-blue",
  flag: "border-input bg-white text-muted-foreground",
  off: "border-input bg-white text-text-light",
};

const PILL_LABEL: Record<string, string> = {
  hard: "Hard requirement",
  pref: "Preference",
  flag: "Flag only",
  off: "Off",
};

export function AccordionSection({
  title,
  desc,
  pill,
  defaultOpen = false,
  children,
}: {
  title: string;
  desc: string;
  pill: "hard" | "pref" | "flag" | "off";
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mb-2.5 overflow-hidden rounded-lg border bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-[18px] py-3.5 text-left hover:bg-[#FAFBFC]"
      >
        <div className="flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-[12.5px] text-muted-foreground">{desc}</div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full border px-2.5 py-[3px] text-[11.5px] font-medium ${PILL_STYLE[pill]}`}
          >
            {PILL_LABEL[pill]}
          </span>
          <span
            className={`text-sm text-text-light transition-transform ${open ? "rotate-90" : ""}`}
          >
            ›
          </span>
        </div>
      </button>
      {open && (
        <div className="border-t px-[18px] pb-5 pt-4">{children}</div>
      )}
    </div>
  );
}
