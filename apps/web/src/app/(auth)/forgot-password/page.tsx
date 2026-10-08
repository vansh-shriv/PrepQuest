"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, Input } from "@prepquest/ui";
import { forgotPasswordSchema } from "@prepquest/shared";
import { AuthCard, FormError } from "@/components/auth/AuthCard";
import { api } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const { run, pending, error, fields, setFields } = useSubmit(async () => {
    await api("/auth/forgot-password", { method: "POST", json: { email } });
    setSent(true);
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!forgotPasswordSchema.safeParse({ email }).success) {
      setFields({ email: "Enter a valid email" });
      return;
    }
    void run();
  };

  return (
    <AuthCard title="Reset password" tone="olive">
      {sent ? (
        <div className="grid gap-4" role="status">
          <p className="m-0">
            If that email has an account, a reset link is on its way. It expires in 1 hour.
          </p>
          <Link href="/login" className="underline">
            Back to log in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fields.email}
          />
          <FormError message={error} />
          <Button type="submit" variant="accent" loading={pending}>
            Send link
          </Button>
          <Link href="/login" className="text-sm underline">
            Back to log in
          </Link>
        </form>
      )}
    </AuthCard>
  );
}
