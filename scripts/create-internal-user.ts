import postgres from "postgres";
import { z } from "zod";

const inputSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["viewer", "reviewer", "administrator"]),
});

const [email, role] = process.argv.slice(2);
const input = inputSchema.safeParse({ email, role });

if (!input.success) {
  process.stderr.write(
    "Usage: pnpm internal:user <email> <viewer|reviewer|administrator>\n",
  );
  process.exitCode = 1;
} else {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    const [user] = await sql<
      Array<{ id: string; email: string; role: string; is_active: boolean }>
    >`
      INSERT INTO internal_user (email, role, is_active)
      VALUES (${input.data.email}, ${input.data.role}, true)
      ON CONFLICT (email) DO UPDATE
      SET role = EXCLUDED.role,
          is_active = true,
          updated_at = now()
      RETURNING id, email, role, is_active
    `;

    if (!user) throw new Error("Internal user was not returned after upsert");

    process.stdout.write(
      `Internal user ready: ${user.email} (${user.role}, active=${user.is_active})\n`,
    );
  } finally {
    await sql.end();
  }
}
