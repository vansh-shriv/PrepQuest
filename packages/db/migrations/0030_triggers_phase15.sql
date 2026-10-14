-- updated_at trigger for the table added in 0029.
CREATE TRIGGER integrity_flags_set_updated_at BEFORE UPDATE ON integrity_flags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
