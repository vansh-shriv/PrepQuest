-- updated_at triggers for the tables added in 0010.
CREATE TRIGGER resumes_set_updated_at BEFORE UPDATE ON resumes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER resume_chunks_set_updated_at BEFORE UPDATE ON resume_chunks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER job_descriptions_set_updated_at BEFORE UPDATE ON job_descriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER interview_sessions_set_updated_at BEFORE UPDATE ON interview_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER interview_turns_set_updated_at BEFORE UPDATE ON interview_turns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER interview_events_set_updated_at BEFORE UPDATE ON interview_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER interview_scorecards_set_updated_at BEFORE UPDATE ON interview_scorecards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER scorecard_scores_set_updated_at BEFORE UPDATE ON scorecard_scores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER transcript_annotations_set_updated_at BEFORE UPDATE ON transcript_annotations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER question_memory_set_updated_at BEFORE UPDATE ON question_memory
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER llm_usage_set_updated_at BEFORE UPDATE ON llm_usage
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
