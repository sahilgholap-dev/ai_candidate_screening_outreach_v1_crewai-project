"use client";

import { UserHeader } from "@/components/user-header";

export default function AdminHome() {
  return (
    <div className="min-h-screen bg-muted/20">
      <UserHeader title="Platform Admin" />
      <main className="p-6">
        <p className="text-muted-foreground">
          Company onboarding and user management arrive in Phase 2.
        </p>
      </main>
    </div>
  );
}
