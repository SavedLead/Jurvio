import type { GovernanceCount } from "../application/get-governance-dashboard";

export function countOf(rows: readonly GovernanceCount[], label: string): number {
  return rows.find((row) => row.label === label)?.value ?? 0;
}

export function qualityHealth(rows: readonly GovernanceCount[]): {
  reviewed: number;
  attention: number;
  total: number;
} {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const reviewed = countOf(rows, "verified");
  const attention = countOf(rows, "conflict") + countOf(rows, "needs_review") + countOf(rows, "stale");
  return { reviewed, attention, total };
}

export function microusdToUsd(value: number): string {
  return (value / 1_000_000).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}
