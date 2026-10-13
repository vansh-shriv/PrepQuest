-- updated_at triggers for the tables added in 0022.
CREATE TRIGGER contests_set_updated_at BEFORE UPDATE ON contests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER contest_problems_set_updated_at BEFORE UPDATE ON contest_problems
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER contest_participants_set_updated_at BEFORE UPDATE ON contest_participants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
