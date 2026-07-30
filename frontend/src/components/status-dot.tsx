import { LibraryStatusKind } from "@/lib/bands";

const DOT_COLOR: Record<LibraryStatusKind, string> = {
  complete: "bg-verdict-pass",
  running: "bg-band-blue animate-pulse",
  review: "bg-verdict-hold",
  cancelled: "bg-text-light",
  error: "bg-verdict-fail",
};

export function StatusDot({ kind }: { kind: LibraryStatusKind }) {
  return (
    <span
      className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${DOT_COLOR[kind]}`}
    />
  );
}
