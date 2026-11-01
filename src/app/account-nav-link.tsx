"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const HINT = "jurvio_signed_in=1";

/** "Sign in" or "Account", decided in the browser so cached pages stay shared. */
export function AccountNavLink({ className, onClick }: { className?: string; onClick?: () => void }) {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    setSignedIn(document.cookie.split(";").some((part) => part.trim() === HINT));
  }, []);
  return signedIn
    ? <Link className={className} href="/account" onClick={onClick}>Account</Link>
    : <Link className={className} href="/signin" onClick={onClick} rel="nofollow">Sign in</Link>;
}
