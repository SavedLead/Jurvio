export const SENSITIVE_ANALYTICS_PREFIXES = [
  "/internal", "/login", "/auth", "/account", "/settings", "/billing",
  "/corrections", "/correction", "/privacy-request", "/privacy",
] as const;

export function analyticsAllowedOnPath(pathname: string): boolean {
  const normalized = pathname.toLocaleLowerCase("en-US");
  return !SENSITIVE_ANALYTICS_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

export function analyticsPathTemplate(pathname: string): string {
  return (pathname.split(/[?#]/, 1)[0] || "/")
    .replace(/\/case\/jv-[a-z0-9]{8,10}/gi, "/case/:caseId")
    .replace(/\/documents\/jd-[a-z0-9]{8,10}/gi, "/documents/:documentId")
    .replace(/\/(?:party|person|organization|attorney|judge|law-firm)\/[^/]+/gi,
      (match) => `/${match.split("/")[1]}/:entityId`)
    .replace(/\/court\/[^/]+/gi, "/court/:courtId");
}
