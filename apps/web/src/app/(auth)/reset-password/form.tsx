"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Input } from "@prepquest/ui";
import { passwordSchema } from "@prepquest/shared";
import { AuthCard, FormError } from "@/components/auth/AuthCard";
import { api } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";

export function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);

  const { run, pending, error, fields, setFields } = useSubmit(async () => {
    await api("/auth/reset-password", { method: "POST", json: { token, password } });
    setDone(true);
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      setFields({ password: parsed.error.issues[0]?.message ?? "Invalid password" });
      return;
    }
    void run();
  };

  if (!token) {
    return (
      <AuthCard title="Reset password" tone="danger">
        <p className="m-0">This reset link is missing its token. Request a new one.</p>
        <Link href="/forgot-password" className="underline">
          Send a new link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="New password" tone="olive">
      {done ? (
        <div className="grid gap-4" role="status">
          <p className="m-0">Password updated. You've been signed out everywhere.</p>
          <Link href="/login" className="underline">
            Log in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fields.password}
            helper="At least 10 characters"
          />
          <FormError message={error} />
          <Button type="submit" variant="accent" loading={pending}>
            Save password
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
