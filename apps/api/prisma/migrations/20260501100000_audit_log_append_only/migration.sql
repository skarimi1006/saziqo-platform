-- SECURITY: audit_logs is the immutable record of every privileged
-- action. UPDATE/DELETE are blocked at the database tier so a compromised
-- application user cannot rewrite history. INSERT and SELECT remain open
-- and the table is intentionally still subject to TRUNCATE by the table
-- owner — only application-level mutations are stopped here. Schema
-- changes themselves still need a real migration.
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs table is append-only — % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
BEFORE UPDATE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();

CREATE TRIGGER audit_logs_no_delete
BEFORE DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();
