"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { EmailPreview } from "@/components/email-preview";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/components/user-header";
import { api, ApiError, OutreachQueueItem } from "@/lib/api";
import { Band, BAND_META } from "@/lib/bands";
import { MyCompany } from "@/lib/requirements";

const PLACEHOLDER_RE = /\[[^\]]+\]/g;

function placeholders(text: string): string[] {
  return [...new Set(text.match(PLACEHOLDER_RE) ?? [])];
}

type Tab = "email" | "sms";

// Mounted with key={item.candidate_id}: draft state initializes per candidate.
function QueueDetail({
  item,
  fromEmail,
  companyName,
  onDone,
}: {
  item: OutreachQueueItem;
  fromEmail: string;
  companyName: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("email");
  const [subject, setSubject] = useState(
    `${item.role_title ?? "New"} role at ${companyName} — thought you'd be a strong fit`,
  );
  const [emailBody, setEmailBody] = useState(item.email_draft ?? "");
  const [smsBody, setSmsBody] = useState(item.sms_draft ?? "");
  const [notice, setNotice] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () =>
      api(`/campaigns/${item.campaign_id}/candidates/${item.candidate_id}/send`, {
        method: "POST",
        body: JSON.stringify({
          email_body: `Subject: ${subject}\n\n${emailBody}`,
          sms_body: smsBody || null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outreach-queue"] });
      queryClient.invalidateQueries({ queryKey: ["outreach-sent"] });
      onDone();
    },
    onError: (e) =>
      setNotice(e instanceof ApiError ? e.message : "Send failed — try again"),
  });

  const skip = useMutation({
    mutationFn: () =>
      api(`/campaigns/${item.campaign_id}/candidates/${item.candidate_id}`, {
        method: "PATCH",
        body: JSON.stringify({ review_status: "later" }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outreach-queue"] });
      onDone();
    },
  });

  const found = placeholders(emailBody);

  return (
    <div className="rounded-[10px] border bg-card p-6 shadow-sm">
      <div className="mb-[18px] flex border-b">
        {(["email", "sms"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] font-medium ${
              tab === t
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "email" ? "Email" : "SMS"}
          </button>
        ))}
        <span className="-mb-px ml-auto cursor-not-allowed border-b-2 border-transparent px-4 py-2.5 text-[13px] font-medium text-text-light">
          LinkedIn (Phase 2)
        </span>
      </div>

      {tab === "email" ? (
        <EmailPreview
          from={fromEmail}
          to={item.email ?? "on file — parsed from resume"}
          subject={subject}
          body={item.email_draft ?? ""}
          onSubjectChange={setSubject}
          onBodyChange={setEmailBody}
        />
      ) : (
        <div className="space-y-2">
          <Textarea
            rows={4}
            value={smsBody}
            onChange={(e) => setSmsBody(e.target.value)}
            placeholder="SMS draft (under 160 characters)"
          />
          <p className="text-xs text-muted-foreground">
            {smsBody.length} characters
            {smsBody.length > 160 && " — over the 160-char SMS limit"}
          </p>
        </div>
      )}

      {found.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-verdict-hold-soft px-4 py-3 text-[12.5px] text-amber-900">
          The draft still contains placeholder text: {found.join(", ")} — fill
          it in before sending.
        </div>
      )}
      {notice && (
        <p className="mt-4 text-[12.5px] text-muted-foreground">{notice}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted-foreground">
          The &quot;from&quot; and &quot;to&quot; fields can&apos;t be changed
          here. Your edits are recorded when you approve.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={skip.isPending}
            onClick={() => skip.mutate()}
          >
            Skip this candidate
          </Button>
          <Button
            disabled={send.isPending || found.length > 0}
            onClick={() => send.mutate()}
          >
            {send.isPending ? "Recording…" : "Approve & send now"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function OutreachQueuePage() {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const { data: company } = useQuery<MyCompany>({
    queryKey: ["my-company"],
    queryFn: () => api("/my/company"),
  });
  const { data: queue, isLoading } = useQuery<OutreachQueueItem[]>({
    queryKey: ["outreach-queue"],
    queryFn: () => api("/outreach/queue"),
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

  const selected =
    queue?.find((q) => q.candidate_id === selectedId) ??
    (queue && queue.length > 0 ? queue[0] : null);

  const sendAll = useMutation({
    mutationFn: async (items: OutreachQueueItem[]) => {
      let sent = 0;
      let skipped = 0;
      for (const item of items) {
        const draft = item.email_draft ?? "";
        if (!draft.trim() || placeholders(draft).length > 0) {
          skipped += 1;
          continue;
        }
        try {
          await api(
            `/campaigns/${item.campaign_id}/candidates/${item.candidate_id}/send`,
            {
              method: "POST",
              body: JSON.stringify({
                email_body: draft,
                sms_body: item.sms_draft || null,
              }),
            },
          );
          sent += 1;
        } catch {
          skipped += 1;
        }
      }
      return { sent, skipped };
    },
    onSuccess: ({ sent, skipped }) => {
      setBulkNotice(
        `${sent} sent${skipped > 0 ? ` · ${skipped} skipped (placeholders or errors)` : ""}`,
      );
      queryClient.invalidateQueries({ queryKey: ["outreach-queue"] });
      queryClient.invalidateQueries({ queryKey: ["outreach-sent"] });
    },
  });

  return (
    <Shell
      title="Outreach queue"
      subtitle={
        queue
          ? `${queue.length} candidate${queue.length === 1 ? "" : "s"} approved and awaiting a message from you`
          : undefined
      }
      actions={
        queue && queue.length > 1 ? (
          <Button
            disabled={sendAll.isPending}
            onClick={() => sendAll.mutate(queue)}
          >
            {sendAll.isPending ? "Sending…" : "Approve & send all"}
          </Button>
        ) : undefined
      }
    >
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {bulkNotice && (
        <p className="mb-4 text-[12.5px] text-muted-foreground">{bulkNotice}</p>
      )}

      {queue && queue.length === 0 && (
        <div className="rounded-[10px] border bg-card p-10 text-center shadow-sm">
          <h2 className="text-[15px] font-semibold">Nothing waiting</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Approve candidates from a search&apos;s results to queue their
            outreach drafts here for review and sending.
          </p>
        </div>
      )}

      {queue && queue.length > 0 && selected && (
        <div className="grid min-h-[600px] items-start gap-5 lg:grid-cols-[320px_1fr]">
          <div className="rounded-[10px] border bg-card p-2 shadow-sm">
            {queue.map((item) => {
              const isSelected = item.candidate_id === selected.candidate_id;
              return (
                <button
                  key={item.candidate_id}
                  type="button"
                  onClick={() => setSelectedId(item.candidate_id)}
                  className={`mb-1 w-full rounded-md border p-3 text-left transition-colors ${
                    isSelected
                      ? "border-verdict-pass bg-verdict-pass-soft"
                      : "border-transparent hover:bg-gray-soft"
                  }`}
                >
                  <div className="mb-0.5 text-[13.5px] font-semibold">
                    {item.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.role_title ?? item.campaign_name} ·{" "}
                    {BAND_META[item.band as Band]?.label ?? item.band}
                  </div>
                </button>
              );
            })}
          </div>

          <QueueDetail
            key={selected.candidate_id}
            item={selected}
            fromEmail={me?.email ?? "you"}
            companyName={company?.name ?? "our company"}
            onDone={() => setSelectedId(null)}
          />
        </div>
      )}
    </Shell>
  );
}
