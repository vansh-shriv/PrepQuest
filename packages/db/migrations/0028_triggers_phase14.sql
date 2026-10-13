-- updated_at triggers for the tables added in 0027.
CREATE TRIGGER code_reviews_set_updated_at BEFORE UPDATE ON code_reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER complexity_analyses_set_updated_at BEFORE UPDATE ON complexity_analyses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
