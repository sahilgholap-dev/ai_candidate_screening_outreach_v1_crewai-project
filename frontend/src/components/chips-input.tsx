"use client";

import { useState } from "react";

// Tag-style multi-value input: Enter or comma adds, × removes.
// strong = emerald chips (used for must-have values).

export function ChipsInput({
  value,
  onChange,
  placeholder,
  strong = false,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  strong?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const item = draft.trim().replace(/,+$/, "");
    if (item && !value.includes(item)) onChange([...value, item]);
    setDraft("");
  }

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-[5px] rounded-md border border-input bg-white px-2 py-1.5">
      {value.map((item) => (
        <span
          key={item}
          className={`inline-flex items-center gap-[5px] rounded px-2 py-[3px] text-[12.5px] ${
            strong ? "bg-verdict-pass-soft text-emerald-900" : "bg-gray-soft"
          }`}
        >
          {item}
          <button
            type="button"
            aria-label={`Remove ${item}`}
            className="text-sm text-text-light hover:text-foreground"
            onClick={() => onChange(value.filter((v) => v !== item))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
        className="min-w-[100px] flex-1 border-none bg-transparent p-1 text-[13px] outline-none placeholder:text-text-light"
      />
    </div>
  );
}
