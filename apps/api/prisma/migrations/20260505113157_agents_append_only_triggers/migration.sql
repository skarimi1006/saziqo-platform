-- Append-only enforcement for agents_run_event.
-- See apps/api/src/modules/agents/CLAUDE.md "Append-only enforcement"
-- for the documented exception (agents_purchase remains mutable for
-- the refund-status flip).

CREATE OR REPLACE FUNCTION prevent_agents_run_event_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'agents_run_event is append-only — % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agents_run_event_no_update
BEFORE UPDATE ON agents_run_event
FOR EACH ROW EXECUTE FUNCTION prevent_agents_run_event_modification();

CREATE TRIGGER agents_run_event_no_delete
BEFORE DELETE ON agents_run_event
FOR EACH ROW EXECUTE FUNCTION prevent_agents_run_event_modification();
