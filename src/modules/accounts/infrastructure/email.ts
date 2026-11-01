// Outbound email behind a provider interface. The only implementation is
// Resend (https://resend.com/docs/api-reference/emails/send-email), configured
// by RESEND_API_KEY and EMAIL_FROM. With either missing there is no provider:
// callers must degrade (dev: log the link; production: "temporarily
// unavailable"; alert job: no-op). Keys are read at call time and never logged.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
  /** Short tag for the provider dashboard, e.g. "signin_link". */
  tag?: string;
}

export interface EmailSendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const response = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          headers: message.headers,
          tags: message.tag ? [{ name: "kind", value: message.tag }] : undefined,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
      if (!response.ok) return { ok: false, error: `resend ${response.status}: ${String(body.name ?? body.message ?? "error").slice(0, 200)}` };
      return { ok: true, providerMessageId: body.id };
    } catch (error) {
      return { ok: false, error: `resend request failed: ${error instanceof Error ? error.name : "error"}` };
    }
  }
}

export interface EmailEnv {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_POSTAL_ADDRESS?: string;
  NODE_ENV?: string;
}

export function emailConfigured(source: EmailEnv = process.env): boolean {
  return Boolean(source.RESEND_API_KEY?.trim() && source.EMAIL_FROM?.trim());
}

export function getEmailProvider(source: EmailEnv = process.env, fetchImpl?: FetchLike): EmailProvider | null {
  if (!emailConfigured(source)) return null;
  return new ResendEmailProvider(source.RESEND_API_KEY!.trim(), source.EMAIL_FROM!.trim(), fetchImpl);
}

export function isProduction(source: EmailEnv = process.env): boolean {
  return source.NODE_ENV === "production";
}

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
