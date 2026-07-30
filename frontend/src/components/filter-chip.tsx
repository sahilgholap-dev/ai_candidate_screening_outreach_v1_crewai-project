export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
        active
          ? "border-foreground bg-foreground text-white"
          : "border-input bg-white text-muted-foreground hover:border-text-light hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
