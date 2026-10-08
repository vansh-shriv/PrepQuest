"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Input, Window } from "@prepquest/ui";
import { apiDownload, api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";

function ExportButton() {
  const { run, pending, error } = useSubmit(async () => {
    const { blob, filename } = await apiDownload("/me/export");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  });
  return (
    <div className="grid gap-2">
      <p className="m-0">Download everything we store about you as a JSON file.</p>
      <FormError message={error} />
      <div>
        <Button size="sm" variant="ghost" loading={pending} onClick={() => void run()}>
          Export my data
        </Button>
      </div>
    </div>
  );
}

function DeleteForm() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const { run, pending, error, fields } = useSubmit(async () => {
    await api("/me", {
      method: "DELETE",
      json: {
        confirm,
        ...(user?.hasPassword ? { password } : {}),
        ...(user?.twoFactorEnabled ? { code } : {}),
      },
    });
    await logout();
    router.replace("/login");
  });

  if (!open) {
    return (
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        Delete my account
      </Button>
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run();
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <p className="m-0">
        Your account and all your data will be permanently deleted after 14 days. Log in again
        before then to cancel.
      </p>
      {user?.hasPassword && (
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      )}
      {user?.twoFactorEnabled && (
        <Input
          label="Current 2FA code"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={fields.code}
        />
      )}
      <Input
        label="Type DELETE to confirm"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={fields.confirm}
      />
      <FormError message={error} />
      <div className="flex gap-3">
        <Button type="submit" variant="danger" loading={pending} disabled={confirm !== "DELETE"}>
          Delete in 14 days
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function DataSection() {
  return (
    <Window title="Your data" tone="blossom">
      <div className="grid gap-6">
        <ExportButton />
        <hr className="m-0 w-full border-0 border-t-[3px] border-ink" />
        <DeleteForm />
      </div>
    </Window>
  );
}
