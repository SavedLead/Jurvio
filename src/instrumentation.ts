export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installRedactionHeader } = await import("@/modules/privacy/application/redaction-header");
  installRedactionHeader();
}
