-- updated_at triggers for the tables added in 0008 (every table needs its own; see schema.test.ts).
CREATE TRIGGER hint_usage_set_updated_at BEFORE UPDATE ON hint_usage
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER xp_events_set_updated_at BEFORE UPDATE ON xp_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER badges_set_updated_at BEFORE UPDATE ON badges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER badges_earned_set_updated_at BEFORE UPDATE ON badges_earned
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER activity_days_set_updated_at BEFORE UPDATE ON activity_days
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
