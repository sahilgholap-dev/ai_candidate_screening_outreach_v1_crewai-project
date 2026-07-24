import { NextRequest, NextResponse } from "next/server";

const TOKEN_COOKIE = "token";
const ROLE_COOKIE = "role";
const MUST_RESET_COOKIE = "must_reset";

function homeFor(role: string | undefined): string {
  return role === "platform_admin" ? "/admin" : "/dashboard";
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  const role = request.cookies.get(ROLE_COOKIE)?.value;
  const mustReset = request.cookies.get(MUST_RESET_COOKIE)?.value === "1";

  const isProtected =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/reset-password");

  if (!token && isProtected) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (token) {
    // Forced password reset: everything funnels to /reset-password
    if (mustReset && !pathname.startsWith("/reset-password")) {
      return NextResponse.redirect(new URL("/reset-password", request.url));
    }
    // Already logged in: keep out of /login
    if (pathname === "/login") {
      return NextResponse.redirect(new URL(homeFor(role), request.url));
    }
    // Role/area mismatch (UX only — the backend enforces real authorization)
    if (pathname.startsWith("/admin") && role !== "platform_admin") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    if (pathname.startsWith("/dashboard") && role === "platform_admin") {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/dashboard/:path*", "/login", "/reset-password"],
};
