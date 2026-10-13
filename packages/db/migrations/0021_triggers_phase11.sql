-- updated_at triggers for the tables added in 0020.
CREATE TRIGGER sql_datasets_set_updated_at BEFORE UPDATE ON sql_datasets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER sql_problems_set_updated_at BEFORE UPDATE ON sql_problems
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER sql_attempts_set_updated_at BEFORE UPDATE ON sql_attempts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER aptitude_items_set_updated_at BEFORE UPDATE ON aptitude_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER oa_templates_set_updated_at BEFORE UPDATE ON oa_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER oa_attempts_set_updated_at BEFORE UPDATE ON oa_attempts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
