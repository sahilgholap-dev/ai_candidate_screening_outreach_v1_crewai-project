"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { CompanyForm, CompanyPayload } from "@/components/company-form";
import { Shell } from "@/components/shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api, Company } from "@/lib/api";

export default function NewCompanyPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  async function onSubmit(payload: CompanyPayload) {
    const company = await api<Company>("/admin/companies", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await queryClient.invalidateQueries({ queryKey: ["companies"] });
    router.push(`/admin/companies/${company.id}`);
  }

  return (
    <Shell title="Onboard company">
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Company profile</CardTitle>
            <CardDescription>
              These details personalize the screening pipeline and outreach
              drafts for every campaign this company runs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CompanyForm onSubmit={onSubmit} submitLabel="Create company" />
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
