"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Input } from "@prepquest/ui";
import { signupSchema } from "@prepquest/shared";
import { AuthCard, FormError } from "@/components/auth/AuthCard";
import { useAuth } from "@/lib/auth-context";
import { useSubmit } from "@/lib/use-submit";

export default function SignupPage() {
  const { signup } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ displayName: "", handle: "", email: "", password: "" });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const { run, pending, error, fields, setFields } = useSubmit(async () => {
    await signup(form);
    router.replace("/dashboard");
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = signupSchema.safeParse(form);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
      setFields(errors);
      return;
    }
    void run();
  };

  return (
    <AuthCard title="New player" tone="coin">
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        <Input
          label="Display name"
          autoComplete="name"
          value={form.displayName}
          onChange={set("displayName")}
          error={fields.displayName}
        />
        <Input
          label="Handle"
          autoComplete="username"
          value={form.handle}
          onChange={set("handle")}
          error={fields.handle}
          helper="Letters, numbers, underscores"
        />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={set("email")}
          error={fields.email}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={set("password")}
          error={fields.password}
          helper="At least 10 characters"
        />
        <FormError message={error} />
        <Button type="submit" variant="accent" loading={pending}>
          Start quest
        </Button>
        <p className="m-0 text-sm">
          Already playing?{" "}
          <Link href="/login" className="underline">
            Log in
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
