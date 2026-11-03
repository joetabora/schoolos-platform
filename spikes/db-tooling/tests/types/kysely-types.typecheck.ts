// Compile-time checks only (never executed). Each @ts-expect-error must remain
// an error; if generated types ever loosen, `tsc` fails with an unused directive.
import type { Tx } from "../../src/db.ts";

export async function typeChecks(tx: Tx): Promise<void> {
  // @ts-expect-error unknown table
  await tx.selectFrom("spike.missing_table").selectAll().execute();

  // @ts-expect-error unknown column
  await tx.selectFrom("spike.schools").select("not_a_column").execute();

  // @ts-expect-error required column `name` missing on insert
  await tx.insertInto("spike.schools").values({ id: "x", organization_id: "y" }).execute();

  // @ts-expect-error uuid columns are strings, not numbers
  await tx.insertInto("spike.schools").values({ id: 1, organization_id: "y", name: "n" }).execute();

  // @ts-expect-error comparing a uuid column to a number
  await tx.selectFrom("spike.schools").selectAll().where("organization_id", "=", 123).execute();

  // @ts-expect-error a column from another table
  await tx.selectFrom("spike.schools").select("body").execute();

  const row = await tx.selectFrom("spike.schools").select(["name", "updated_at"]).executeTakeFirstOrThrow();
  const name: string = row.name;
  const updatedAt: Date = row.updated_at;
  // @ts-expect-error selected text is string, not number
  const wrong: number = row.name;

  // Generated (defaulted) columns are optional on insert.
  await tx.insertInto("spike.schools").values({ id: "x", organization_id: "y", name: "n" }).execute();

  // bigint sequence: selected as string, insertable as number | bigint | string.
  const event = await tx.selectFrom("spike.org_events").select("seq").executeTakeFirstOrThrow();
  const seq: string = event.seq;
  await tx.insertInto("spike.org_events").values({ organization_id: "y", seq: 1n, action: "probe" }).execute();

  void [name, updatedAt, wrong, seq];
}
