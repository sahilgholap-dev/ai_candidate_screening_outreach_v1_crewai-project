"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

type Me = {
  id: number;
  email: string;
  full_name: string | null;
  role: string;
  company_id: number | null;
};

export function useMe() {
  return useQuery<Me>({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await fetch("/api/backend/auth/me");
      if (!res.ok) throw new Error("Failed to load user");
      return res.json();
    },
  });
}

export function UserHeader({ title }: { title: string }) {
  const router = useRouter();
  const { data: me } = useMe();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <header className="flex items-center justify-between border-b bg-background px-6 py-4">
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="flex items-center gap-4">
        {me && (
          <span className="text-sm text-muted-foreground">
            {me.full_name ?? me.email}
            {me.role === "platform_admin" && " · Admin"}
          </span>
        )}
        <Button variant="outline" size="sm" onClick={logout}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
