-- updated_at triggers for the tables added in 0017.
CREATE TRIGGER srs_cards_set_updated_at BEFORE UPDATE ON srs_cards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER srs_reviews_set_updated_at BEFORE UPDATE ON srs_reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER quiz_questions_set_updated_at BEFORE UPDATE ON quiz_questions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER quiz_attempts_set_updated_at BEFORE UPDATE ON quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER quiz_attempt_answers_set_updated_at BEFORE UPDATE ON quiz_attempt_answers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER roadmaps_set_updated_at BEFORE UPDATE ON roadmaps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER user_tracks_set_updated_at BEFORE UPDATE ON user_tracks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
