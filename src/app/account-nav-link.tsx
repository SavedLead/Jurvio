"use client";

import Link from "next/link";
import { useSignedInHint } from "@/modules/accounts/ui/use-signed-in-hint";

/** "Sign in" or "Account", decided in the browser so cached pages stay shared. */
export function AccountNavLink({ className, onClick }: { className?: string; onClick?: () => void }) {
  const signedIn = useSignedInHint();
  return signedIn
    ? <Link className={className} href="/account" onClick={onClick}>Account</Link>
    : <Link className={className} href="/signin" onClick={onClick} rel="nofollow">Sign in</Link>;
}
