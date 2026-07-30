"use client";

// Email-client style preview: locked From/To headers, editable subject and
// body. Body edits surface as plain text through onBodyChange.

import { useEffect, useRef } from "react";

export function EmailPreview({
  from,
  to,
  subject,
  body,
  onSubjectChange,
  onBodyChange,
}: {
  from: string;
  to: string;
  subject: string;
  body: string;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Seed / reseed the editable body only when the candidate (body identity)
  // changes from outside — never on each keystroke.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && el.innerText.trim() !== body.trim()) {
      el.innerText = body;
    }
  }, [body]);

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="border-b bg-[#FAFBFC] px-4 py-3 text-[12.5px]">
        <div className="flex py-[3px]">
          <span className="w-[60px] shrink-0 text-muted-foreground">From:</span>
          <span>{from}</span>
        </div>
        <div className="flex py-[3px]">
          <span className="w-[60px] shrink-0 text-muted-foreground">To:</span>
          <span>{to}</span>
        </div>
        <div className="flex items-center py-[3px]">
          <span className="w-[60px] shrink-0 text-muted-foreground">
            Subject:
          </span>
          <input
            value={subject}
            onChange={(e) => onSubjectChange(e.target.value)}
            className="w-full border-none bg-transparent font-medium outline-none"
          />
        </div>
      </div>
      <div
        ref={bodyRef}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onBodyChange((e.target as HTMLElement).innerText)}
        className="min-h-[220px] whitespace-pre-wrap p-5 text-[13.5px] leading-[1.65] outline-none focus:bg-[#FDFDFD]"
      />
    </div>
  );
}
