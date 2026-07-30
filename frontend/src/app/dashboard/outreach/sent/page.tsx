"use client";

import { useQuery } from "@tanstack/react-query";

import { Shell } from "@/components/shell";
import { api, SentOutreachRow } from "@/lib/api";
import { relTime } from "@/lib/relative-time";

export default function SentOutreachPage() {
  const { data: rows, isLoading } = useQuery<SentOutreachRow[]>({
    queryKey: ["outreach-sent"],
    queryFn: () => api("/outreach/sent"),
  });

  return (
    <Shell
      title="Sent outreach"
      subtitle="Messages already approved and sent from your workspace"
    >
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {rows && rows.length === 0 && (
        <div className="rounded-[10px] border bg-card p-10 text-center shadow-sm">
          <h2 className="text-[15px] font-semibold">Nothing sent yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Approved messages you send from the outreach queue are recorded
            here with the reviewer and timestamp.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-[10px] border bg-card shadow-sm">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b bg-[#FAFBFC]">
                {["Candidate", "Search", "Sent", "Sent by"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.candidate_id} className="border-b last:border-b-0">
                  <td className="px-4 py-3.5 text-[13.5px] font-semibold">
                    {r.name}
                  </td>
                  <td className="px-4 py-3.5 text-[13.5px]">
                    {r.campaign_name}
                  </td>
                  <td className="px-4 py-3.5 text-[13.5px] text-muted-foreground">
                    {relTime(r.sent_at)}
                  </td>
                  <td className="px-4 py-3.5 text-[13.5px]">{r.sent_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
