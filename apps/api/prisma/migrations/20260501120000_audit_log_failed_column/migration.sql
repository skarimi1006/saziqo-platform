-- Add failed column to audit_logs so the admin viewer can filter on it
-- without a full payload scan. The column is denormalized from the payload
-- for query performance; the canonical record is still in payloadHash.
ALTER TABLE "audit_logs" ADD COLUMN "failed" BOOLEAN NOT NULL DEFAULT false;
