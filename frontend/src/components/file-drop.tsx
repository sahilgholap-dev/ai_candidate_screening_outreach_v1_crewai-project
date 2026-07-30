"use client";

import { useRef, useState } from "react";

// Dashed drop zone wrapping a hidden file input (drag or click).

export function FileDrop({
  accept,
  multiple = false,
  onFiles,
  primary,
  secondary,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  primary: string;
  secondary?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const extensions = accept.split(",").map((e) => e.trim().toLowerCase());

  function accepted(files: FileList | null): File[] {
    return Array.from(files ?? []).filter((f) =>
      extensions.some((ext) => f.name.toLowerCase().endsWith(ext)),
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = accepted(e.dataTransfer.files);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
      className={`cursor-pointer rounded-lg border-2 border-dashed p-[22px] text-center transition-colors ${
        dragging
          ? "border-primary bg-verdict-pass-soft"
          : "border-input bg-gray-soft hover:border-primary hover:bg-verdict-pass-soft"
      }`}
    >
      <div className="mb-1.5 text-2xl text-muted-foreground">↑</div>
      <div className="text-[13.5px] font-medium">{primary}</div>
      {secondary && (
        <div className="mt-[3px] text-xs text-muted-foreground">{secondary}</div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = accepted(e.target.files);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
