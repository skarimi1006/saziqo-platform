-- Extend ledger_entries with metadata JSON column (for cross-references and
-- extensible context) and widen description to 500 chars per plan spec.

ALTER TABLE "ledger_entries" ALTER COLUMN "description" TYPE VARCHAR(500);
ALTER TABLE "ledger_entries" ADD COLUMN "metadata" JSONB;
