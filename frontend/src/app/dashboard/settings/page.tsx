"use client";

// Workspace settings — our own layout (deliberately NOT the mockup's):
// read-only view of the real company profile.

import { useQuery } from "@tanstack/react-query";

import { Shell } from "@/components/shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, REGION_LABELS } from "@/lib/api";
import { MyCompany } from "@/lib/requirements";

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[13px] font-medium">{label}</Label>
      <Input value={value} disabled />
    </div>
  );
}

export default function WorkspaceSettingsPage() {
  const { data: company, isLoading } = useQuery<MyCompany>({
    queryKey: ["my-company"],
    queryFn: () => api("/my/company"),
  });

  return (
    <Shell
      title="Workspace settings"
      subtitle="Read-only here · changes go through your MasterTech onboarder"
    >
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {company && (
        <div className="rounded-[10px] border bg-card px-6 py-[22px] shadow-sm">
          <h2 className="text-[15px] font-semibold tracking-tight">
            Your workspace
          </h2>
          <p className="mb-[18px] mt-1 text-[12.5px] text-muted-foreground">
            Set during onboarding · needs a call to change
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <ReadOnlyField label="Company" value={company.name} />
            <ReadOnlyField
              label="Region"
              value={
                REGION_LABELS[company.default_region] ?? company.default_region
              }
            />
            <ReadOnlyField
              label="Office locations"
              value={company.office_locations.join(", ") || "—"}
            />
            <ReadOnlyField
              label="Outreach signature"
              value={company.recruiter_signature ?? "—"}
            />
            <ReadOnlyField
              label="Voice / tone"
              value={company.tone_notes ?? "Professional yet warm"}
            />
            <ReadOnlyField
              label="Candidate data retention"
              value={
                company.data_retention_days
                  ? `${company.data_retention_days} days`
                  : "No automatic purge"
              }
            />
          </div>
        </div>
      )}
    </Shell>
  );
}
