import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  AUTH_COOKIE_OPTIONS,
  BACKEND_URL,
  MUST_RESET_COOKIE,
  ROLE_COOKIE,
  TOKEN_COOKIE,
} from "@/lib/backend";

export async function POST(request: NextRequest) {
  const body = await request.json();

  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  const cookieStore = await cookies();
  cookieStore.set(TOKEN_COOKIE, data.access_token, AUTH_COOKIE_OPTIONS);
  cookieStore.set(ROLE_COOKIE, data.role, AUTH_COOKIE_OPTIONS);
  cookieStore.set(
    MUST_RESET_COOKIE,
    data.must_reset_password ? "1" : "0",
    AUTH_COOKIE_OPTIONS,
  );

  // Token stays in httpOnly cookies — never exposed to client JS.
  return NextResponse.json({
    role: data.role,
    must_reset_password: data.must_reset_password,
    full_name: data.full_name,
  });
}
