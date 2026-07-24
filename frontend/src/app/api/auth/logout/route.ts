import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { MUST_RESET_COOKIE, ROLE_COOKIE, TOKEN_COOKIE } from "@/lib/backend";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(TOKEN_COOKIE);
  cookieStore.delete(ROLE_COOKIE);
  cookieStore.delete(MUST_RESET_COOKIE);
  return NextResponse.json({ success: true });
}
