export type HttpValidators = {
  etag?: string | null;
  lastModified?: string | null;
};

/** Headers for a conditional GET. Empty when we have nothing stored. */
export function conditionalRequestHeaders(validators?: HttpValidators | null): Record<string, string> {
  const headers: Record<string, string> = {};
  const etag = validators?.etag?.trim();
  const lastModified = validators?.lastModified?.trim();
  if (etag) headers["If-None-Match"] = etag;
  if (lastModified) headers["If-Modified-Since"] = lastModified;
  return headers;
}
