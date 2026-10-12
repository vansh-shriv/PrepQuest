-- updated_at triggers for the tables added in 0015.
CREATE TRIGGER study_plans_set_updated_at BEFORE UPDATE ON study_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER plan_tasks_set_updated_at BEFORE UPDATE ON plan_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER plan_diffs_set_updated_at BEFORE UPDATE ON plan_diffs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER goal_templates_set_updated_at BEFORE UPDATE ON goal_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER daily_goals_set_updated_at BEFORE UPDATE ON daily_goals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER readiness_snapshots_set_updated_at BEFORE UPDATE ON readiness_snapshots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER diagnostics_set_updated_at BEFORE UPDATE ON diagnostics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
