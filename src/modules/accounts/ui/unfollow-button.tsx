"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function UnfollowButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <button type="button" className="accountButton secondary" disabled={busy} onClick={async () => {
    setBusy(true);
    await fetch(`/api/follows/${encodeURIComponent(caseId)}`, { method: "DELETE", credentials: "same-origin", headers: { Accept: "application/json" } }).catch(() => undefined);
    router.refresh();
    setBusy(false);
  }}>Unfollow</button>;
}
