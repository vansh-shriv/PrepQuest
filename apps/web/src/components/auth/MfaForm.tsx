"use client";

import { useState, type FormEvent } from "react";
import { Button, Input } from "@prepquest/ui";
import { totpCodeSchema } from "@prepquest/shared";
import { useAuth } from "@/lib/auth-context";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "./AuthCard";

/** Second step of sign-in: a 6-digit authenticator code, or a one-time recovery code. */
export function MfaForm({ mfaToken, onDone }: { mfaToken: string; onDone: () => void }) {
  const { completeMfa } = useAuth();
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState("");

  const { run, pending, error, fields, setFields } = useSubmit(async () => {
    await completeMfa({
      mfaToken,
      ...(useRecovery ? { recoveryCode: value } : { code: value }),
    });
    onDone();
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!useRecovery) {
      const parsed = totpCodeSchema.safeParse(value);
      if (!parsed.success) {
        setFields({ code: parsed.error.issues[0]?.message ?? "Enter the 6-digit code" });
        return;
      }
    } else if (value.trim().length < 8) {
      setFields({ code: "Enter a recovery code" });
      return;
    }
    void run();
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <p className="m-0">
        {useRecovery
          ? "Enter one of your saved recovery codes. Each works once."
          : "Open your authenticator app and enter the 6-digit code."}
      </p>
      <Input
        label={useRecovery ? "Recovery code" : "Authentication code"}
        autoComplete="one-time-code"
        inputMode={useRecovery ? "text" : "numeric"}
        autoFocus
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setFields({});
        }}
        error={fields.code}
      />
      <FormError message={error} />
      <Button type="submit" variant="accent" loading={pending}>
        Verify
      </Button>
      <button
        type="button"
        className="justify-self-start text-sm underline"
        onClick={() => {
          setUseRecovery((v) => !v);
          setValue("");
          setFields({});
        }}
      >
        {useRecovery ? "Use authenticator app instead" : "Use a recovery code"}
      </button>
    </form>
  );
}
