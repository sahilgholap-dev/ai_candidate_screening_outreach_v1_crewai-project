"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { RequirementsForm } from "@/components/requirements-form";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import {
  defaultRequirements,
  MyCompany,
  RequirementsProfile,
} from "@/lib/requirements";

type Region = "US" | "UK" | "IN";

export default function NewCampaignPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: company } = useQuery<MyCompany>({
    queryKey: ["my-company"],
    queryFn: () => api("/my/company"),
  });

  const [name, setName] = useState("");
  const [region, setRegion] = useState<Region>("IN");
  const [threshold, setThreshold] = useState<number>(65);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [resumeFiles, setResumeFiles] = useState<FileList | null>(null);
  const [requirements, setRequirements] = useState<RequirementsProfile>(
    defaultRequirements(),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (company) {
      setRegion(company.default_region);
      setThreshold(company.default_threshold);
    }
  }, [company]);

  async function submit() {
    setError(null);
    if (!name.trim()) return setError("Campaign name is required");
    if (!jdFile) return setError("Upload a job description file");
    if (!resumeFiles || resumeFiles.length === 0)
      return setError("Upload at least one resume");
    if (
      requirements.gender_eligibility !== "any" &&
      !requirements.gender_justification?.trim()
    )
      return setError("Gender-restricted campaigns require a justification");

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("campaign_name", name.trim());
      fd.append("threshold", String(threshold));
      fd.append("region", region);
      fd.append("requirements", JSON.stringify(requirements));
      fd.append("jd_file", jdFile);
      Array.from(resumeFiles).forEach((f) => fd.append("resume_files", f));

      const res = await fetch("/api/backend/campaigns", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data.detail === "string" ? data.detail : "Failed to create campaign",
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      router.push(`/dashboard/campaigns/${data.campaign_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create campaign");
      setSubmitting(false);
    }
  }

  return (
    <Shell title="New campaign">
      <div className="mx-auto max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Campaign basics</CardTitle>
            <CardDescription>
              Job description and resumes to screen.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="name">Campaign name</Label>
                <Input
                  id="name"
                  placeholder="e.g. Jr. Digital Marketing Executive — July"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Region</Label>
                <Select value={region} onValueChange={(v) => setRegion(v as Region)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IN">India</SelectItem>
                    <SelectItem value="US">United States</SelectItem>
                    <SelectItem value="UK">United Kingdom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="threshold">Shortlist threshold (0–100)</Label>
                <Input
                  id="threshold"
                  type="number"
                  min={0}
                  max={100}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="jd">Job description (PDF/DOCX/TXT)</Label>
                <Input
                  id="jd"
                  type="file"
                  accept=".pdf,.docx,.txt"
                  onChange={(e) => setJdFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="resumes">Resumes (multiple)</Label>
                <Input
                  id="resumes"
                  type="file"
                  accept=".pdf,.docx,.txt"
                  multiple
                  onChange={(e) => setResumeFiles(e.target.files)}
                />
                {resumeFiles && (
                  <p className="text-xs text-muted-foreground">
                    {resumeFiles.length} file(s) selected
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Requirements</CardTitle>
            <CardDescription>
              What the JD doesn&apos;t say — your answers override the JD when
              they conflict.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {company && (
              <RequirementsForm
                value={requirements}
                onChange={setRequirements}
                region={region}
                company={company}
              />
            )}
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-wrap justify-end gap-3 pb-10">
          <Button variant="outline" onClick={() => router.push("/dashboard")}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Uploading…" : "Create & run campaign"}
          </Button>
        </div>
      </div>
    </Shell>
  );
}
