"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Company } from "@/lib/api";

const companySchema = z.object({
  name: z.string().min(1, "Company name is required"),
  default_region: z.enum(["US", "UK", "IN"]),
  pitch: z.string().optional(),
  office_locations_text: z.string().optional(),
  recruiter_signature: z.string().optional(),
  tone_notes: z.string().optional(),
  default_threshold: z.number().min(0).max(100),
  allow_gender_eligibility: z.boolean(),
  data_retention_days: z
    .string()
    .optional()
    .refine((v) => !v || (/^\d+$/.test(v) && Number(v) >= 1), {
      message: "Enter a whole number of days",
    }),
});

export type CompanyFormValues = z.infer<typeof companySchema>;

export type CompanyPayload = {
  name: string;
  default_region: string;
  pitch: string | null;
  office_locations: string[];
  recruiter_signature: string | null;
  tone_notes: string | null;
  default_threshold: number;
  allow_gender_eligibility: boolean;
  data_retention_days: number | null;
};

export function toPayload(values: CompanyFormValues): CompanyPayload {
  return {
    name: values.name.trim(),
    default_region: values.default_region,
    pitch: values.pitch?.trim() || null,
    office_locations: (values.office_locations_text ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    recruiter_signature: values.recruiter_signature?.trim() || null,
    tone_notes: values.tone_notes?.trim() || null,
    default_threshold: values.default_threshold,
    allow_gender_eligibility: values.allow_gender_eligibility,
    data_retention_days: values.data_retention_days
      ? Number(values.data_retention_days)
      : null,
  };
}

export function CompanyForm({
  initial,
  onSubmit,
  submitLabel,
}: {
  initial?: Company;
  onSubmit: (payload: CompanyPayload) => Promise<void>;
  submitLabel: string;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CompanyFormValues>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: initial?.name ?? "",
      default_region: initial?.default_region ?? "IN",
      pitch: initial?.pitch ?? "",
      office_locations_text: (initial?.office_locations ?? []).join("\n"),
      recruiter_signature: initial?.recruiter_signature ?? "",
      tone_notes: initial?.tone_notes ?? "",
      default_threshold: initial?.default_threshold ?? 65,
      allow_gender_eligibility: initial?.allow_gender_eligibility ?? false,
      data_retention_days: initial?.data_retention_days?.toString() ?? "",
    },
  });

  async function submit(values: CompanyFormValues) {
    setServerError(null);
    try {
      await onSubmit(toPayload(values));
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Request failed");
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Company name</Label>
          <Input id="name" {...register("name")} />
          {errors.name && (
            <p className="text-sm text-destructive">{errors.name.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label>Primary region</Label>
          <Controller
            control={control}
            name="default_region"
            render={({ field }) => (
              <Select
                items={{ IN: "India", US: "United States", UK: "United Kingdom" }}
                value={field.value}
                onValueChange={field.onChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN">India</SelectItem>
                  <SelectItem value="US">United States</SelectItem>
                  <SelectItem value="UK">United Kingdom</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="pitch">Company pitch</Label>
        <Textarea
          id="pitch"
          rows={3}
          placeholder="One short paragraph used in outreach drafts to sell the company to candidates."
          {...register("pitch")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="office_locations_text">Office locations (one per line)</Label>
        <Textarea
          id="office_locations_text"
          rows={2}
          placeholder={"Thane West, Mumbai\nBengaluru"}
          {...register("office_locations_text")}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="recruiter_signature">Recruiter signature</Label>
          <Textarea
            id="recruiter_signature"
            rows={3}
            placeholder={"Jane Doe\nTalent Acquisition, Acme Corp"}
            {...register("recruiter_signature")}
          />
          <p className="text-xs text-muted-foreground">
            Used to sign outreach emails — replaces bracketed placeholders.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="tone_notes">Outreach tone notes</Label>
          <Textarea
            id="tone_notes"
            rows={3}
            placeholder="e.g. Warm but professional. No emojis. Formal salutations."
            {...register("tone_notes")}
          />
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="default_threshold">Default shortlist threshold (0–100)</Label>
          <Input
            id="default_threshold"
            type="number"
            min={0}
            max={100}
            {...register("default_threshold", { valueAsNumber: true })}
          />
          {errors.default_threshold && (
            <p className="text-sm text-destructive">
              {errors.default_threshold.message}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="data_retention_days">
            Candidate data retention (days, blank = keep)
          </Label>
          <Input
            id="data_retention_days"
            type="number"
            min={1}
            placeholder="e.g. 180"
            {...register("data_retention_days")}
          />
        </div>
      </div>

      <div className="flex items-start justify-between rounded-lg border p-4">
        <div className="pr-4">
          <Label htmlFor="allow_gender_eligibility" className="font-medium">
            Allow gender-restricted campaigns
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Permits this company to mark a campaign as women-only / men-only.
            Lawful for certain roles in India; in the US/UK only under narrow
            BFOQ / Genuine Occupational Requirement rules. Each restricted
            campaign requires a written justification and is audit-logged.
            Candidates whose resume does not explicitly state gender are never
            auto-rejected — they are routed to human review.
          </p>
        </div>
        <Controller
          control={control}
          name="allow_gender_eligibility"
          render={({ field }) => (
            <Switch
              id="allow_gender_eligibility"
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
      </div>

      {serverError && <p className="text-sm text-destructive">{serverError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
