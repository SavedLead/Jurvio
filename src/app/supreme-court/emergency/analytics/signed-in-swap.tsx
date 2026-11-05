"use client";

import type { ReactNode } from "react";
import { useSignedInHint } from "@/modules/accounts/ui/use-signed-in-hint";

/**
 * The emergency pages are edge-cached for anonymous visitors, and Cloudflare
 * serves those cached copies to signed-in visitors too. The sign-up teaser is
 * rendered for everyone; a signed-in browser swaps it for the plain link.
 */
export function SignedInSwap({ anonymous, signedIn }: { anonymous: ReactNode; signedIn: ReactNode }) {
  const isSignedIn = useSignedInHint();
  return <>{isSignedIn ? signedIn : anonymous}</>;
}
