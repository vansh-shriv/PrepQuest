-- updated_at triggers for the tables added in 0033.
--> statement-breakpoint
CREATE TRIGGER peer_availability_set_updated_at BEFORE UPDATE ON peer_availability
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER peer_sessions_set_updated_at BEFORE UPDATE ON peer_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER peer_invites_set_updated_at BEFORE UPDATE ON peer_invites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER peer_feedback_set_updated_at BEFORE UPDATE ON peer_feedback
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER peer_blocks_set_updated_at BEFORE UPDATE ON peer_blocks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER peer_reports_set_updated_at BEFORE UPDATE ON peer_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
