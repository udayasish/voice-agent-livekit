import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgDatabase, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type * as models from "./models/index.js";

export type Models = typeof models;
export type Database = NodePgDatabase<Models>;
export type Transaction = PgTransaction<NodePgQueryResultHKT, Models, ExtractTablesWithRelations<Models>>;
export type OnCommitCallback = () => void | Promise<void>;
export type TransactionWithHooks = Transaction & { onCommit(callback: OnCommitCallback): void };

// Existing transaction/onCommit pattern extracted so isolated databases use the same helper.
export function createTransactionWithHooks(
  database: Database,
  logger: { error(message: string, metadata: Record<string, unknown>): unknown },
) {
  return async <T>(fn: (tx: TransactionWithHooks) => Promise<T>): Promise<T> => {
    const callbacks: OnCommitCallback[] = [];
    const result = await database.transaction(async (tx) => {
      const withHooks = tx as TransactionWithHooks;
      withHooks.onCommit = (callback) => { callbacks.push(callback); };
      return fn(withHooks);
    });
    for (const callback of callbacks) {
      try { await callback(); }
      catch { logger.error("Post-commit callback failed", { errorCode: "POST_COMMIT_FAILED" }); }
    }
    return result;
  };
}

export type RunTransaction = ReturnType<typeof createTransactionWithHooks>;
