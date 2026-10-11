-- updated_at triggers for the tables added in 0012.
CREATE TRIGGER question_bank_set_updated_at BEFORE UPDATE ON question_bank
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER company_packs_set_updated_at BEFORE UPDATE ON company_packs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER ideal_answers_set_updated_at BEFORE UPDATE ON ideal_answers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER star_scores_set_updated_at BEFORE UPDATE ON star_scores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER speech_metrics_set_updated_at BEFORE UPDATE ON speech_metrics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
