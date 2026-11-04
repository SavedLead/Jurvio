/** Addresses that are ours or test fixtures are not "outside people". */
export function isOutsideEmail(email: string): boolean {
  const e = email.toLowerCase();
  return !(e.endsWith("@jurvio.com") || e.includes("example") || e.includes("cleanyourname"));
}
