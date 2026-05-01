-- SECURITY: ledger_entries is the immutable double-entry bookkeeping record.
-- UPDATE/DELETE are blocked at the database tier so a compromised
-- application user cannot rewrite money history. INSERT and SELECT remain
-- open. The reconciliation job (Phase 9E) verifies balance integrity nightly.
CREATE OR REPLACE FUNCTION prevent_ledger_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries table is append-only — % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_no_update
BEFORE UPDATE ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_modification();

CREATE TRIGGER ledger_no_delete
BEFORE DELETE ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_modification();
