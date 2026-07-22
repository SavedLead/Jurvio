import postgres from "postgres";
import { env } from "@/lib/config/env";

let client: ReturnType<typeof postgres> | undefined;

export function db() {
  client ??= postgres(env().DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true,
    transform: { undefined: null },
  });
  return client;
}

export async function closeDb() {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
  }
}
