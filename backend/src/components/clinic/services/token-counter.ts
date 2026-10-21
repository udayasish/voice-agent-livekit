import { sql } from "drizzle-orm";
import type { Transaction } from "../../../lib/db/transaction-with-hooks.js";
import { clinicTokenCounters } from "../models/index.js";

/** Caller holds the doctor's date advisory lock. Counter never decreases on moves/cancellation. */
export async function allocateToken(tx: Transaction, organizationId: string, doctorId: string, date: string) {
  const [counter] = await tx.insert(clinicTokenCounters).values({ organizationId, doctorId, date, lastToken: 1 })
    .onConflictDoUpdate({ target: [clinicTokenCounters.organizationId, clinicTokenCounters.doctorId, clinicTokenCounters.date],
      set: { lastToken: sql`${clinicTokenCounters.lastToken} + 1` } }).returning();
  if (!counter) throw new Error("Token allocation failed");
  return counter.lastToken;
}
