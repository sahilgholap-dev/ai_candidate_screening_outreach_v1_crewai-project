// Server-side only: base URL of the FastAPI backend.
export const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export const TOKEN_COOKIE = "token";
export const ROLE_COOKIE = "role";
export const MUST_RESET_COOKIE = "must_reset";

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 12, // matches backend ACCESS_TOKEN_TTL_HOURS
};
