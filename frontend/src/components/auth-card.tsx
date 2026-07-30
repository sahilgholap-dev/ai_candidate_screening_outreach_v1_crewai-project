// Auth screens: dark-green gradient page with a centered white card.

export function AuthPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0A1F1A] to-[#143329] p-10">
      <div className="w-full max-w-[400px] rounded-[14px] bg-white p-10 text-foreground shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
        {children}
      </div>
    </div>
  );
}

export function AuthBrand({ tag }: { tag: string }) {
  return (
    <div className="mb-7 text-center">
      <div className="text-[11px] font-bold tracking-[2px] text-primary">
        NEXUS
      </div>
      <div className="mt-1 text-[22px] font-bold tracking-tight">
        Talent Match
      </div>
      <div className="mt-1.5 text-[13px] text-muted-foreground">{tag}</div>
    </div>
  );
}
