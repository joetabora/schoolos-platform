import { provisionLocalPasswords, rolePool } from "./helpers.ts";

export async function setup(): Promise<void> {
  const superuser = rolePool("postgres");
  try {
    const { rows } = await superuser.query<{ server_version: string }>("show server_version");
    const version = rows[0]?.server_version ?? "";
    if (!version.startsWith("18.6")) {
      throw new Error(`expected PostgreSQL 18.6, got ${version}`);
    }
    await provisionLocalPasswords(superuser);
  } finally {
    await superuser.end();
  }
}
