-- updated_at triggers for the tables added in 0003 (every table needs its own; see schema.test.ts).
CREATE TRIGGER draft_history_set_updated_at BEFORE UPDATE ON draft_history
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER admin_audit_log_set_updated_at BEFORE UPDATE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
