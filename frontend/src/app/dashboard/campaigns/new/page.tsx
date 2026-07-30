"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { AccordionSection } from "@/components/accordion-section";
import { ChipsInput } from "@/components/chips-input";
import { FileDrop } from "@/components/file-drop";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import {
  isFolderAlreadyBound,
  isFolderPickSupported,
  listResumeFiles,
  pickFolder,
  saveBinding,
} from "@/lib/folder-watch";
import {
  defaultRequirements,
  MyCompany,
  RequirementsProfile,
} from "@/lib/requirements";

function Field({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[13px] font-medium">
        {label}
        {optional && (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            (optional)
          </span>
        )}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CardBox({
  title,
  sub,
  badge,
  children,
}: {
  title: string;
  sub?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 rounded-[10px] border bg-card px-6 py-[22px] shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {badge}
      </div>
      {sub && (
        <p className="mb-[18px] mt-1 text-[12.5px] text-muted-foreground">
          {sub}
        </p>
      )}
      {children}
    </div>
  );
}

const InfoBanner = ({ children }: { children: React.ReactNode }) => (
  <div className="flex gap-3 rounded-lg border border-blue-200 bg-band-blue-soft px-4 py-3 text-[13px] text-blue-950">
    <span className="shrink-0 text-lg leading-tight">ⓘ</span>
    <div>{children}</div>
  </div>
);

export default function NewSearchPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: company } = useQuery<MyCompany>({
    queryKey: ["my-company"],
    queryFn: () => api("/my/company"),
  });

  const [name, setName] = useState("");
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [resumeFiles, setResumeFiles] = useState<File[]>([]);
  const [intakeMode, setIntakeMode] = useState<"upload" | "folder">("upload");
  const [folderHandle, setFolderHandle] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [req, setReq] = useState<RequirementsProfile>(defaultRequirements());
  const [mustHaveSkills, setMustHaveSkills] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const folderSupported = useSyncExternalStore(
    () => () => {},
    () => isFolderPickSupported(),
    () => false,
  );

  const set = <K extends keyof RequirementsProfile>(
    key: K,
    v: RequirementsProfile[K],
  ) => setReq((r) => ({ ...r, [key]: v }));

  useEffect(() => {
    // Region and threshold are agent-internal; company defaults apply silently.
  }, [company]);

  async function chooseFolder() {
    setError(null);
    try {
      const handle = await pickFolder();
      const boundTo = await isFolderAlreadyBound(handle);
      if (boundTo !== null) {
        return setError(
          `This folder is already watched by search #${boundTo}. One folder per search.`,
        );
      }
      setFolderHandle(handle);
      setFolderFiles(await listResumeFiles(handle));
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Couldn't open folder");
    }
  }

  async function submit() {
    setError(null);
    if (!name.trim()) return setError("Search name is required");
    if (!req.role_title?.trim()) return setError("Role title is required");
    if (!jdFile) return setError("Upload the job description");
    if (intakeMode === "upload" && resumeFiles.length === 0)
      return setError("Upload at least one resume");
    if (intakeMode === "folder" && !folderHandle)
      return setError("Choose a folder to watch");
    if (!req.office_location?.trim())
      return setError("Required location is mandatory — fill in Location & work mode");
    if (!req.work_mode)
      return setError("Choose a work mode in Location & work mode");
    if (!req.dealbreakers?.trim())
      return setError("Add at least one dealbreaker (with its one-line reason)");

    setSubmitting(true);
    try {
      const profile: RequirementsProfile = {
        ...req,
        must_have_skills: mustHaveSkills.map((skill) => ({
          skill,
          min_years: null,
        })),
        licenses_mode: req.licenses.length > 0 ? "hard_filter" : "off",
      };

      const fd = new FormData();
      fd.append("campaign_name", name.trim());
      fd.append("requirements", JSON.stringify(profile));
      fd.append("jd_file", jdFile);
      fd.append("intake_mode", intakeMode);
      if (intakeMode === "folder" && folderHandle) {
        fd.append("folder_name", folderHandle.name);
        folderFiles.forEach((f) => fd.append("resume_files", f));
      } else {
        resumeFiles.forEach((f) => fd.append("resume_files", f));
      }

      const res = await fetch("/api/backend/campaigns", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data.detail === "string" ? data.detail : "Failed to start the search",
        );
      }
      if (intakeMode === "folder" && folderHandle) {
        await saveBinding(data.campaign_id, folderHandle);
      }
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      router.push(`/dashboard/campaigns/${data.campaign_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start the search");
      setSubmitting(false);
    }
  }

  return (
    <Shell
      title="Start new search"
      subtitle="Tell us about the role — we'll find the matches"
      actions={
        <>
          <Button variant="outline" onClick={() => router.push("/dashboard")}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Starting…" : "Start search"}
          </Button>
        </>
      }
    >
      {/* The role */}
      <CardBox
        title="The role"
        sub="Give the search a name for your own filing, upload the job description, and set the urgency."
      >
        <div className="mb-4 grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
          <Field label="Search name" hint="Only visible to your team.">
            <Input
              placeholder="e.g. Senior Data Engineer — August"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Role title">
            <Input
              placeholder="e.g. Senior Data Engineer"
              value={req.role_title ?? ""}
              onChange={(e) => set("role_title", e.target.value || null)}
            />
          </Field>
          <Field label="Openings">
            <Input
              type="number"
              min={1}
              value={req.openings ?? ""}
              onChange={(e) =>
                set("openings", e.target.value ? Number(e.target.value) : null)
              }
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Job description">
            {jdFile ? (
              <div className="flex items-center justify-between rounded-lg border bg-gray-soft px-4 py-3 text-[13.5px]">
                <span className="truncate font-medium">{jdFile.name}</span>
                <button
                  type="button"
                  className="ml-3 text-text-light hover:text-foreground"
                  onClick={() => setJdFile(null)}
                >
                  ×
                </button>
              </div>
            ) : (
              <FileDrop
                accept=".pdf,.docx,.txt"
                onFiles={(files) => setJdFile(files[0] ?? null)}
                primary="Drop PDF, DOCX, or TXT — or click to browse"
                secondary="The JD is the primary source of truth. Extra requirements below fill in what the JD doesn't say."
              />
            )}
          </Field>
          <div className="space-y-4">
            <Field
              label="Urgency"
              hint="Only affects your view of pace on the search — the agent works at the same speed."
            >
              <Select
                items={{
                  standard: "Standard — usual pace",
                  high: "High — hire needed within 4 weeks",
                  critical: "Critical — hire needed within 2 weeks",
                }}
                value={req.urgency ?? "standard"}
                onValueChange={(v) =>
                  set("urgency", v as RequirementsProfile["urgency"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard — usual pace</SelectItem>
                  <SelectItem value="high">
                    High — hire needed within 4 weeks
                  </SelectItem>
                  <SelectItem value="critical">
                    Critical — hire needed within 2 weeks
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Target start date">
              <Input
                type="date"
                value={req.target_join_date ?? ""}
                onChange={(e) =>
                  set("target_join_date", e.target.value || null)
                }
              />
            </Field>
          </div>
        </div>
      </CardBox>

      {/* Where we'll search */}
      <CardBox
        title="Where we'll search"
        sub="Upload the resumes to screen, or point us at a folder we keep watching."
      >
        <div className="mb-4 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={intakeMode === "upload" ? "default" : "outline"}
            onClick={() => setIntakeMode("upload")}
          >
            Upload resume files
          </Button>
          <Button
            type="button"
            size="sm"
            variant={intakeMode === "folder" ? "default" : "outline"}
            disabled={!folderSupported}
            onClick={() => setIntakeMode("folder")}
          >
            Watch a folder
          </Button>
        </div>
        {!folderSupported && (
          <p className="-mt-2 mb-3 text-xs text-muted-foreground">
            Folder watching needs Chrome or Edge.
          </p>
        )}

        {intakeMode === "upload" ? (
          <>
            <FileDrop
              accept=".pdf,.docx,.txt"
              multiple
              onFiles={(files) =>
                setResumeFiles((prev) => {
                  const seen = new Set(prev.map((f) => f.name + f.size));
                  return [
                    ...prev,
                    ...files.filter((f) => !seen.has(f.name + f.size)),
                  ];
                })
              }
              primary="Drop resumes here — or click to browse"
              secondary="PDF, DOCX, or TXT · up to 200 resumes per search"
            />
            {resumeFiles.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {resumeFiles.length} file(s) ready.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => setResumeFiles([])}
                >
                  Clear
                </button>
              </p>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <Button type="button" variant="outline" onClick={chooseFolder}>
              {folderHandle ? "Change folder…" : "Choose folder…"}
            </Button>
            {folderHandle && (
              <p className="text-xs text-muted-foreground">
                📁 {folderHandle.name} — {folderFiles.length} resume(s) found
                now; new files are screened automatically.
              </p>
            )}
            <InfoBanner>
              Folder watching syncs while the app is open in your browser.
              Resumes dropped in while it&apos;s closed are picked up the next
              time you open it.
            </InfoBanner>
          </div>
        )}
      </CardBox>

      {/* Requirements sections */}
      <CardBox
        title="What matters beyond the JD"
        sub="Location & work mode and Absolute dealbreakers are required — they can rule candidates out, so we need your answer. Everything else is optional: fill in what the JD doesn't say, or where you want your answer to override it. Preferences affect how we rank; hard requirements can rule someone out."
      >
        <AccordionSection
          title="Team & seniority"
          desc="Where the person will sit, how senior, what industry background helps."
          pill="pref"
          defaultOpen
        >
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Seniority we're expecting"
              hint="A range, not a floor. We won't reject anyone for being outside this — we use it to shape scoring."
            >
              <Select
                items={{
                  any: "Any",
                  junior: "Junior (0–2 years)",
                  mid: "Mid (2–5 years)",
                  senior: "Senior (5–10 years)",
                  lead: "Lead (8+ years)",
                  manager: "Manager",
                }}
                value={req.seniority ?? "any"}
                onValueChange={(v) =>
                  set(
                    "seniority",
                    v === "any" ? null : (v as RequirementsProfile["seniority"]),
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="junior">Junior (0–2 years)</SelectItem>
                  <SelectItem value="mid">Mid (2–5 years)</SelectItem>
                  <SelectItem value="senior">Senior (5–10 years)</SelectItem>
                  <SelectItem value="lead">Lead (8+ years)</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Industry background that helps">
              <ChipsInput
                value={req.industries}
                onChange={(v) => {
                  set("industries", v);
                  set("industries_mode", v.length ? "preference" : "off");
                }}
                placeholder="Type and press enter…"
              />
            </Field>
          </div>
          <Field
            label="Team the candidate will join"
            optional
            hint="Used in the outreach draft to add colour."
          >
            <Input
              placeholder="e.g. Data platform team — 6 engineers, reports to Head of Engineering"
              value={req.team_context ?? ""}
              onChange={(e) => set("team_context", e.target.value || null)}
            />
          </Field>
        </AccordionSection>

        <AccordionSection
          title="Location & work mode"
          desc="Required. Where the candidate needs to be — this can rule candidates out."
          pill="hard"
          defaultOpen
        >
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <Field label="Required location">
              <Input
                placeholder="e.g. Manchester, UK"
                value={req.office_location ?? ""}
                onChange={(e) => set("office_location", e.target.value || null)}
              />
            </Field>
            <Field label="Work mode">
              <Select
                items={{
                  any: "Any",
                  onsite: "On-site",
                  hybrid: "Hybrid (2–3 days onsite)",
                  remote: "Remote",
                }}
                value={req.work_mode ?? "any"}
                onValueChange={(v) =>
                  set(
                    "work_mode",
                    v === "any" ? null : (v as RequirementsProfile["work_mode"]),
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="onsite">On-site</SelectItem>
                  <SelectItem value="hybrid">Hybrid (2–3 days onsite)</SelectItem>
                  <SelectItem value="remote">Remote</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Commute tolerance"
              hint="Candidates in neighbouring cities won't be filtered out."
            >
              <Select
                items={{
                  same_city: "Same city only",
                  metro_area: "Same metro area (neighbouring cities OK)",
                }}
                value={req.commute_rule ?? "metro_area"}
                onValueChange={(v) =>
                  set("commute_rule", v as RequirementsProfile["commute_rule"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="same_city">Same city only</SelectItem>
                  <SelectItem value="metro_area">
                    Same metro area (neighbouring cities OK)
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Relocation acceptable?">
              <Select
                items={{
                  yes: "Only if the candidate says they're open to it",
                  no: "No — local candidates only",
                }}
                value={req.relocation_acceptable ? "yes" : "no"}
                onValueChange={(v) => set("relocation_acceptable", v === "yes")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">
                    Only if the candidate says they&apos;re open to it
                  </SelectItem>
                  <SelectItem value="no">No — local candidates only</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </AccordionSection>

        <AccordionSection
          title="Must-have skills & credentials"
          desc="Skills that genuinely matter, and any credentials the role legally requires."
          pill="pref"
          defaultOpen
        >
          <div className="mb-4">
            <Field label="Must-have skills" hint="Ranked heavily in scoring.">
              <ChipsInput
                value={mustHaveSkills}
                onChange={setMustHaveSkills}
                placeholder="Add a skill…"
                strong
              />
            </Field>
          </div>
          <div className="mb-4">
            <Field label="Nice-to-have skills">
              <ChipsInput
                value={req.nice_to_have_skills}
                onChange={(v) => set("nice_to_have_skills", v)}
                placeholder="Add a skill…"
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Required credentials"
              optional
              hint="Certifications the role can't be done without. We treat these as hard requirements."
            >
              <ChipsInput
                value={req.licenses}
                onChange={(v) => set("licenses", v)}
                placeholder="e.g. Chartered Accountant, Bar-certified…"
              />
            </Field>
            <Field
              label="Education"
              hint='Default is "Any" — filtering on degree screens out equally capable self-taught candidates.'
            >
              <Select
                items={{
                  any: "Any (we won't filter on education)",
                  degree: "Degree required (or equivalent experience)",
                }}
                value={req.education_degree_required ? "degree" : "any"}
                onValueChange={(v) => {
                  set("education_degree_required", v === "degree");
                  set("education_mode", v === "degree" ? "preference" : "off");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">
                    Any (we won&apos;t filter on education)
                  </SelectItem>
                  <SelectItem value="degree">
                    Degree required (or equivalent experience)
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </AccordionSection>

        <AccordionSection
          title="What makes someone thrive here"
          desc="The qualitative signal the JD never captures. Two or three sentences is enough."
          pill="pref"
        >
          <div className="mb-4">
            <Field
              label="How would you describe someone who does well at your company?"
              hint="We use this to shape the outreach voice and to weigh softer signals in the ranking."
            >
              <Textarea
                rows={3}
                value={req.culture_text ?? ""}
                onChange={(e) => set("culture_text", e.target.value || null)}
                placeholder="e.g. Careful with detail, comfortable owning a piece end-to-end, interested in the domain — not just the tech."
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Signals to look for" optional>
              <ChipsInput
                value={req.positive_signals}
                onChange={(v) => set("positive_signals", v)}
                placeholder="Add a signal…"
              />
            </Field>
            <Field label="Signals that would concern you" optional>
              <ChipsInput
                value={req.concern_signals}
                onChange={(v) => set("concern_signals", v)}
                placeholder="Add a signal…"
              />
            </Field>
          </div>
        </AccordionSection>

        <AccordionSection
          title="Absolute dealbreakers"
          desc="Required. The explicit &quot;never&quot; list — anything here rules someone out immediately, and we log each rejection with the reason you give."
          pill="hard"
          defaultOpen
        >
          <Field
            label="Dealbreakers (each one needs a one-line reason)"
            hint="Every candidate ruled out under a dealbreaker gets a specific audit-log entry citing which one and why."
          >
            <Textarea
              rows={3}
              value={req.dealbreakers ?? ""}
              onChange={(e) => set("dealbreakers", e.target.value || null)}
              placeholder={
                "One per line. Example: Worked at [named competitor] within the last 12 months — non-solicit clause in place."
              }
            />
          </Field>
        </AccordionSection>
      </CardBox>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-3 pb-10">
        <Button variant="outline" onClick={() => router.push("/dashboard")}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting
            ? "Starting…"
            : intakeMode === "folder" && folderFiles.length === 0
              ? "Create & watch folder"
              : "Start search"}
        </Button>
      </div>
    </Shell>
  );
}
