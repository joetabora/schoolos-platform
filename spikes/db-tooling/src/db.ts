import pg from "pg";
import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import type { DB } from "./db-types.ts";

export type TenantContext = {
  readonly orgId: string;
  readonly userId: string;
};

export type Tx = Transaction<DB>;

export type TenantDb = {
  withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Transaction with no tenant context. RLS must deny every tenant row. */
  withoutTenantContext<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  readonly pool: pg.Pool;
  close(): Promise<void>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function assertUuid(value: string, name: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${name} must be a lower-case UUID`);
  }
}

/**
 * The only way the spike runs tenant queries: one module-private Kysely over
 * one pg.Pool. Handlers receive a Kysely Transaction, which is pinned to one
 * pooled connection, rejects nested transactions, and rejects use after the
 * transaction has finished.
 */
export function createTenantDb(config: pg.PoolConfig): TenantDb {
  const pool = new pg.Pool(config);
  pool.on("error", (err) => {
    console.error(`idle pg client error: ${err.message}`);
  });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

  return {
    pool,
    async withTenant(ctx, fn) {
      assertUuid(ctx.orgId, "orgId");
      assertUuid(ctx.userId, "userId");
      return db.transaction().execute(async (tx) => {
        await sql`select
            set_config('app.current_org_id', ${ctx.orgId}, true),
            set_config('app.current_user_id', ${ctx.userId}, true)`.execute(tx);
        return fn(tx);
      });
    },
    async withoutTenantContext(fn) {
      return db.transaction().execute(fn);
    },
    async close() {
      await db.destroy();
    },
  };
}
