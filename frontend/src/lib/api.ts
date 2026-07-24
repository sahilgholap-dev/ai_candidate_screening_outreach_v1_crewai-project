// Client-side API helpers. Everything goes through the authenticated
// /api/backend proxy — the JWT never leaves its httpOnly cookie.

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/backend${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
    throw new ApiError(401, "Session expired");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
}

// ---------- Types ----------

export type Company = {
  id: number;
  name: string;
  pitch: string | null;
  office_locations: string[];
  default_region: "US" | "UK" | "IN";
  recruiter_signature: string | null;
  tone_notes: string | null;
  default_threshold: number;
  allow_gender_eligibility: boolean;
  data_retention_days: number | null;
  is_active: boolean;
  created_at: string | null;
  user_count: number;
  campaign_count: number;
  total_tokens: number;
  llm_requests: number;
};

export type CompanyUser = {
  id: number;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  must_reset_password: boolean;
  created_at: string | null;
  temp_password?: string;
};

export const REGION_LABELS: Record<string, string> = {
  US: "United States",
  UK: "United Kingdom",
  IN: "India",
};
