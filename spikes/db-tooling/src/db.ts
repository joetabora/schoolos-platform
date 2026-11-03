import pg from "pg";
import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import type { DB } from "./db-types.ts";

export type TenantContext = {
  readonly orgId: string;
  readonly userId: string;
};

export type Tx = Transaction<DB>;

/** PostgreSQL: current transaction is aborted, commands ignored until end of transaction block. */
const IN_FAILED_SQL_TRANSACTION = "25P02";

export class TransactionAbortedError extends Error {
  override readonly name = "TransactionAbortedError";
  constructor(cause?: unknown) {
    super(
      "database transaction is aborted; the wrapper fails the request even if the handler caught the original error",
    );
    this.cause = cause;
  }
}

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

function sqlState(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return undefined;
}

/**
 * PostgreSQL turns COMMIT of an aborted transaction into a silent ROLLBACK.
 * Probe before Kysely commits so a handler that caught the original error
 * cannot succeed the request.
 */
async function assertTransactionOpen(tx: Tx): Promise<void> {
  try {
    await sql`select 1`.execute(tx);
  } catch (err) {
    if (sqlState(err) === IN_FAILED_SQL_TRANSACTION) {
      throw new TransactionAbortedError(err);
    }
    throw err;
  }
}

/**
 * The only way the spike runs tenant queries: one module-private pg.Pool and
 * one module-private root Kysely. Handlers receive only a Kysely Transaction,
 * which is pinned to one pooled connection, rejects nested transactions, and
 * rejects use after the transaction has finished.
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
        const result = await fn(tx);
        await assertTransactionOpen(tx);
        return result;
      });
    },
    async withoutTenantContext(fn) {
      return db.transaction().execute(async (tx) => {
        const result = await fn(tx);
        await assertTransactionOpen(tx);
        return result;
      });
    },
    async close() {
      await db.destroy();
    },
  };
}
