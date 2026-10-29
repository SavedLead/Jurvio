// Splits a migration file into separately committed chunks.
// A line that is exactly `-- @commit` ends the current chunk. Existing
// migrations have no marker, so they stay one chunk and keep today's behavior.

export function splitMigrationChunks(source) {
  return source
    .split(/^\s*--\s*@commit\s*$/m)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.split("\n").some((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("--");
    }));
}
