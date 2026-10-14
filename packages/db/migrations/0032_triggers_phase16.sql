-- updated_at triggers for the tables added in 0031.
CREATE TRIGGER system_design_prompts_set_updated_at BEFORE UPDATE ON system_design_prompts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER design_canvases_set_updated_at BEFORE UPDATE ON design_canvases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
