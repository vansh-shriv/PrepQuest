-- updated_at triggers for the tables added in 0024.
CREATE TRIGGER flashcard_decks_set_updated_at BEFORE UPDATE ON flashcard_decks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER flashcards_set_updated_at BEFORE UPDATE ON flashcards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER flashcard_reviews_set_updated_at BEFORE UPDATE ON flashcard_reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER shared_reports_set_updated_at BEFORE UPDATE ON shared_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
