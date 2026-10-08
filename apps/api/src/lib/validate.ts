import type { ZodType } from "zod";
import { AppError } from "@prepquest/shared";

/** Parse untrusted input with a Zod schema; failures become a 422 VALIDATION_FAILED AppError. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
    throw new AppError("VALIDATION_FAILED", 422, "Invalid input", { fields });
  }
  return result.data;
}
