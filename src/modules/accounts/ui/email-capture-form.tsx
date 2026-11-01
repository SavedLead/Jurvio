"use client";

import { useState, type ReactNode } from "react";
import "./email-capture-form.css";

interface CaptureResponse { status?: string; message?: string; error?: string }

const ERROR_TEXT: Record<string, string> = {
  invalid: "Enter a valid email address.",
  email_required: "Enter a valid email address.",
  rate_limited: "Too many requests. Wait a few minutes and try again.",
};

export const WAITLIST_SUCCESS = "You're on the list; we'll email you when alerts go live.";

/**
 * Email box that works with or without JavaScript. Without JS the form posts
 * and the server redirects back with a success flag; with JS it posts as JSON
 * and swaps in the confirmation. A visually hidden "company" field is a bot
 * honeypot.
 */
export function EmailCaptureForm({
  action, hidden, buttonLabel, className, inputLabel = "Email address", footnote, initialMessage,
}: {
  action: string;
  hidden: Record<string, string>;
  buttonLabel: string;
  className?: string;
  inputLabel?: string;
  footnote?: ReactNode;
  initialMessage?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(initialMessage ?? "");
  const [error, setError] = useState("");

  if (done) return <p className="emailCaptureDone" role="status">{done}</p>;

  return <form className={`emailCapture${className ? ` ${className}` : ""}`} action={action} method="post" onSubmit={async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setBusy(true);
    setError("");
    try {
      const response = await fetch(action, {
        method: "POST", credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await response.json().catch(() => ({})) as CaptureResponse;
      if (body.status === "waitlisted") {
        setDone(body.message ?? WAITLIST_SUCCESS);
      } else if (body.status === "sent" || body.status === "logged") {
        setDone("Check your email for a one-time sign-in link. It expires in 15 minutes.");
      } else {
        setError(ERROR_TEXT[body.status ?? body.error ?? ""] ?? "Something went wrong. Try again.");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }}>
    <input type="email" name="email" required maxLength={254} autoComplete="email" placeholder="you@example.com" aria-label={inputLabel} />
    <span className="emailCaptureTrap" aria-hidden="true">
      <label>Company <input type="text" name="company" tabIndex={-1} autoComplete="off" defaultValue="" /></label>
    </span>
    {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
    <button type="submit" disabled={busy}>{busy ? "Saving…" : buttonLabel}</button>
    {error ? <small className="emailCaptureError" role="alert">{error}</small> : null}
    {footnote ? <small>{footnote}</small> : null}
  </form>;
}
