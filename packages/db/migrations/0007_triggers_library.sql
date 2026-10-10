-- updated_at triggers for the tables added in 0006 (every table needs its own; see schema.test.ts).
CREATE TRIGGER bookmarks_set_updated_at BEFORE UPDATE ON bookmarks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER notes_set_updated_at BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
