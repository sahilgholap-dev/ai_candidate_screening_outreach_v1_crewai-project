import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { BACKEND_URL, MUST_RESET_COOKIE, TOKEN_COOKIE } from "@/lib/backend";

// Generic authenticated proxy: /api/backend/<path> -> <BACKEND_URL>/api/<path>
// The JWT lives in an httpOnly cookie; this handler attaches it as a Bearer
// header so client components never touch the token.

async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_COOKIE)?.value;

  const url = `${BACKEND_URL}/api/${path.join("/")}${request.nextUrl.search}`;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (token) headers.set("authorization", `Bearer ${token}`);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  const res = await fetch(url, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    // @ts-expect-error - duplex is required by Node fetch for streamed bodies
    duplex: hasBody ? "half" : undefined,
    cache: "no-store",
  });

  // Session expired or revoked: drop auth cookies so proxy.ts sends the user
  // back to /login instead of looping on 401s.
  if (res.status === 401) {
    cookieStore.delete(TOKEN_COOKIE);
  }

  // Successful password reset clears the forced-reset flag.
  if (res.ok && path.join("/") === "auth/reset-password") {
    cookieStore.set(MUST_RESET_COOKIE, "0", { path: "/" });
  }

  const responseHeaders = new Headers();
  const resContentType = res.headers.get("content-type");
  if (resContentType) responseHeaders.set("content-type", resContentType);

  return new NextResponse(res.body, {
    status: res.status,
    headers: responseHeaders,
  });
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
};
