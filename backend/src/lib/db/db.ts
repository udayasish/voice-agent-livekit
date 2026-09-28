import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import env from "../env.js";
import logger from "../logger.js";
import * as schema from "./models/index.js";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  keepAlive: true,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  logger.error("Unexpected error on idle Postgres client", { err });
});

export const models = schema;
export type Models = typeof schema;

const _db = drizzle(pool, { schema });

type OnCommitCallback = () => void | Promise<void>;
export type Transaction = PgTransaction<
  NodePgQueryResultHKT,
  Models,
  ExtractTablesWithRelations<Models>
>;

export const transactionWithHooks = async <T>(
  fn: (tx: Transaction & { onCommit: (cb: OnCommitCallback) => void }) => Promise<T>
): Promise<T> => {
  const postCommitCallbacks: OnCommitCallback[] = [];
  const result = await _db.transaction(async (tx) => {
    const txWithHooks = tx as Transaction & {
      onCommit: (cb: OnCommitCallback) => void;
    };
    txWithHooks.onCommit = (cb: OnCommitCallback) => {
      postCommitCallbacks.push(cb);
    };
    return await fn(txWithHooks);
  });

  for (const callback of postCommitCallbacks) {
    try {
      await callback();
    } catch (e) {
      logger.error("Error in onCommit callback:", e);
    }
  }

  return result;
};

export const db = _db;
