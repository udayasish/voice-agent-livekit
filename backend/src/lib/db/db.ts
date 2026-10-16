import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import env from "../env.js";
import logger from "../logger.js";
import * as schema from "./models/index.js";
import { createTransactionWithHooks } from "./transaction-with-hooks.js";
export type { Transaction } from "./transaction-with-hooks.js";

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

export const transactionWithHooks = createTransactionWithHooks(_db, logger);

export const db = _db;
