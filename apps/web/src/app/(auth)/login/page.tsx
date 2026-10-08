"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Input } from "@prepquest/ui";
import { loginSchema } from "@prepquest/shared";
import { AuthCard, FormError } from "@/components/auth/AuthCard";
import { useAuth } from "@/lib/auth-context";
import { useSubmit } from "@/lib/use-submit";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const { run, pending, error, fields, setFields } = useSubmit(async () => {
    await login({ email, password });
    router.replace("/dashboard");
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFields(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    void run();
  };

  return (
    <AuthCard title="Press start">
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fields.email}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fields.password}
        />
        <FormError message={error} />
        <Button type="submit" variant="accent" loading={pending}>
          Log in
        </Button>
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <Link href="/forgot-password" className="underline">
            Forgot password?
          </Link>
          <Link href="/signup" className="underline">
            Create account
          </Link>
        </div>
      </form>
    </AuthCard>
  );
}
