"use client";

import { useCallback, useState } from "react";
import { ApiError } from "./api";

/** Wraps an async form submit: tracks pending state and splits errors into field and general ones. */
export function useSubmit<Args extends unknown[]>(action: (...args: Args) => Promise<void>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const run = useCallback(
    async (...args: Args): Promise<boolean> => {
      setPending(true);
      setError(null);
      setFields({});
      try {
        await action(...args);
        return true;
      } catch (err) {
        if (err instanceof ApiError) {
          const f = err.fields;
          if (Object.keys(f).length > 0) setFields(f);
          else setError(err.message);
        } else {
          setError("Can't reach the server. Check your connection and try again.");
        }
        return false;
      } finally {
        setPending(false);
      }
    },
    [action],
  );

  return { run, pending, error, fields, setFields, setError };
}
