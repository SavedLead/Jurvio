"use client";

import { useEffect, useState, type ReactNode } from "react";

const HINT = "jurvio_signed_in=1";

/**
 * The emergency pages are edge-cached for anonymous visitors, and Cloudflare
 * serves those cached copies to signed-in visitors too. The sign-up teaser is
 * rendered for everyone; a signed-in browser swaps it for the plain link.
 */
export function SignedInSwap({ anonymous, signedIn }: { anonymous: ReactNode; signedIn: ReactNode }) {
  const [isSignedIn, setSignedIn] = useState(false);
  useEffect(() => {
    setSignedIn(document.cookie.split(";").some((part) => part.trim() === HINT));
  }, []);
  return <>{isSignedIn ? signedIn : anonymous}</>;
}
