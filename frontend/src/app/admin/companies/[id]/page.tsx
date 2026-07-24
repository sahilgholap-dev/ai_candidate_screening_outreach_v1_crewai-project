"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";

import { CompanyForm, CompanyPayload } from "@/components/company-form";
import { Shell } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, Company, CompanyUser } from "@/lib/api";

function TempPasswordNotice({
  user,
  onDismiss,
}: {
  user: CompanyUser;
  onDismiss: () => void;
}) {
  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
      <p className="font-medium text-amber-900">
        Temporary password for {user.email}
      </p>
      <p className="mt-1 font-mono text-lg text-amber-900">{user.temp_password}</p>
      <p className="mt-1 text-amber-800">
        Shown only once — share it securely. The user must change it on first
        login.
      </p>
      <Button variant="outline" size="sm" className="mt-2" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}

function UsersPanel({ companyId }: { companyId: number }) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createdUser, setCreatedUser] = useState<CompanyUser | null>(null);

  const { data: users } = useQuery<CompanyUser[]>({
    queryKey: ["company-users", companyId],
    queryFn: () => api(`/admin/companies/${companyId}/users`),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["company-users", companyId] });

  const createUser = useMutation({
    mutationFn: () =>
      api<CompanyUser>(`/admin/companies/${companyId}/users`, {
        method: "POST",
        body: JSON.stringify({ email, full_name: fullName || null }),
      }),
    onSuccess: (user) => {
      setCreatedUser(user);
      setDialogOpen(false);
      setEmail("");
      setFullName("");
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  const toggleActive = useMutation({
    mutationFn: (user: CompanyUser) =>
      api(`/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !user.is_active }),
      }),
    onSuccess: invalidate,
  });

  const resetPassword = useMutation({
    mutationFn: (user: CompanyUser) =>
      api<CompanyUser>(`/admin/users/${user.id}/reset-password`, {
        method: "POST",
      }),
    onSuccess: (user) => setCreatedUser(user),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Users</CardTitle>
          <CardDescription>Logins for this company&apos;s recruiters.</CardDescription>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Add user
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create user login</DialogTitle>
              <DialogDescription>
                A temporary password is generated and shown once; the user must
                change it on first login.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="new-user-email">Email</Label>
                <Input
                  id="new-user-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-user-name">Full name (optional)</Label>
                <Input
                  id="new-user-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button
                onClick={() => createUser.mutate()}
                disabled={!email || createUser.isPending}
              >
                {createUser.isPending ? "Creating…" : "Create user"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {createdUser?.temp_password && (
          <TempPasswordNotice
            user={createdUser}
            onDismiss={() => setCreatedUser(null)}
          />
        )}
        {users && users.length === 0 && (
          <p className="text-sm text-muted-foreground">No users yet.</p>
        )}
        {users && users.length > 0 && (
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.email}</TableCell>
                  <TableCell>{u.full_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={u.is_active ? "default" : "destructive"}>
                      {u.is_active ? "Active" : "Deactivated"}
                    </Badge>
                    {u.must_reset_password && (
                      <Badge variant="secondary" className="ml-2">
                        Pending reset
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => resetPassword.mutate(u)}
                    >
                      Reset password
                    </Button>
                    <Button
                      variant={u.is_active ? "destructive" : "default"}
                      size="sm"
                      onClick={() => toggleActive.mutate(u)}
                    >
                      {u.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const companyId = Number(id);
  const queryClient = useQueryClient();

  const { data: company } = useQuery<Company>({
    queryKey: ["company", companyId],
    queryFn: () => api(`/admin/companies/${companyId}`),
  });

  const toggleCompanyActive = useMutation({
    mutationFn: () =>
      api(`/admin/companies/${companyId}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !company?.is_active }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company", companyId] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
  });

  async function onSubmit(payload: CompanyPayload) {
    await api(`/admin/companies/${companyId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    await queryClient.invalidateQueries({ queryKey: ["company", companyId] });
    await queryClient.invalidateQueries({ queryKey: ["companies"] });
  }

  return (
    <Shell title={company?.name ?? "Company"}>
      <div className="mx-auto max-w-3xl space-y-6">
        {company && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge variant={company.is_active ? "default" : "destructive"}>
                  {company.is_active ? "Active" : "Deactivated"}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {company.campaign_count} campaigns · {company.user_count} users
                </span>
              </div>
              <Button
                variant={company.is_active ? "destructive" : "default"}
                size="sm"
                onClick={() => toggleCompanyActive.mutate()}
              >
                {company.is_active ? "Deactivate company" : "Reactivate company"}
              </Button>
            </div>

            <UsersPanel companyId={companyId} />

            <Card>
              <CardHeader>
                <CardTitle>Company profile</CardTitle>
                <CardDescription>
                  Changes apply to all future campaigns.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CompanyForm
                  initial={company}
                  onSubmit={onSubmit}
                  submitLabel="Save changes"
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Shell>
  );
}
