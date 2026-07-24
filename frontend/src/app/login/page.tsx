"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type LoginValues = z.infer<typeof loginSchema>;

function BrandPanel() {
  return (
    <div className="relative flex flex-col justify-between overflow-hidden bg-sidebar p-8 text-sidebar-foreground lg:p-12">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-2xl font-bold tracking-tight text-sidebar-primary">
          NEXUS
        </span>
        <span className="text-xs font-medium uppercase tracking-[0.16em] text-sidebar-foreground/60">
          screening
        </span>
      </div>

      <div className="my-10 max-w-sm lg:my-0">
        <h1 className="font-display text-3xl font-semibold leading-tight lg:text-4xl">
          Every resume, read.
          <br />
          Every score, explained.
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-sidebar-foreground/70">
          Upload a job description and a stack of resumes. NEXUS screens each
          candidate against your requirements, shows its evidence, and drafts
          the outreach — you approve every message before it goes anywhere.
        </p>
      </div>

      {/* The verdict system, stated honestly */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-sidebar-foreground/70">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-verdict-pass" /> Shortlist
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-verdict-hold" /> Needs review
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-verdict-fail" /> Not eligible
        </span>
      </div>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justReset = searchParams.get("reset") === "1";
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginValues) {
    setServerError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) {
      setServerError(data.detail ?? "Login failed");
      return;
    }
    if (data.must_reset_password) {
      router.push("/reset-password");
    } else {
      router.push(data.role === "platform_admin" ? "/admin" : "/dashboard");
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[5fr_7fr]">
      <BrandPanel />
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <h2 className="font-display text-xl font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the login your administrator created for you.
          </p>

          {justReset && (
            <p className="mt-4 rounded-md border border-verdict-pass/30 bg-verdict-pass-soft p-3 text-sm text-verdict-pass">
              Password updated. Sign in with your new password.
            </p>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                {...register("email")}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...register("password")}
              />
              {errors.password && (
                <p className="text-sm text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>
            {serverError && (
              <p className="text-sm text-destructive">{serverError}</p>
            )}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
