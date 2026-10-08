"use client";

import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Chip, Input, Window } from "@prepquest/ui";
import { totpCodeSchema } from "@prepquest/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";

type Step =
  | { kind: "idle" }
  | { kind: "enrolling"; secret: string; otpauthUrl: string }
  | { kind: "codes"; codes: string[] }
  | { kind: "disabling" };

function SetupPanel({
  secret,
  otpauthUrl,
  onDone,
  onCancel,
}: {
  secret: string;
  otpauthUrl: string;
  onDone: (codes: string[]) => void;
  onCancel: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    void QRCode.toDataURL(otpauthUrl, { margin: 1, width: 192 }).then(setQr, () => setQr(null));
  }, [otpauthUrl]);

  const { run, pending, error, fields, setFields } = useSubmit(async () => {
    const res = await api<{ recoveryCodes: string[] }>("/auth/2fa/verify", {
      method: "POST",
      json: { code },
    });
    onDone(res.recoveryCodes);
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = totpCodeSchema.safeParse(code);
    if (!parsed.success) return setFields({ code: "Enter the 6-digit code" });
    void run();
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <p className="m-0">
        Scan this with an authenticator app (Google Authenticator, 1Password, Authy).
      </p>
      {qr && (
        <img
          src={qr}
          alt="QR code for your authenticator app"
          width={192}
          height={192}
          className="bg-white"
        />
      )}
      <p className="m-0 text-sm">
        Can&apos;t scan? Enter this key manually:
        <br />
        <code className="break-all" data-testid="totp-secret">
          {secret}
        </code>
      </p>
      <Input
        label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        error={fields.code}
      />
      <FormError message={error} />
      <div className="flex gap-3">
        <Button type="submit" loading={pending}>
          Turn on
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RecoveryCodes({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const download = () => {
    const blob = new Blob([`PrepQuest recovery codes\n\n${codes.join("\n")}\n`], {
      type: "text/plain",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "prepquest-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <div className="grid gap-4">
      <p className="m-0" role="status">
        Two-factor authentication is on. Save these recovery codes now: each works once if you lose
        your phone, and they won&apos;t be shown again.
      </p>
      <ul
        className="pq-font-pixel m-0 grid list-none grid-cols-2 gap-1 p-0 text-xl"
        data-testid="recovery-codes"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex gap-3">
        <Button size="sm" variant="ghost" onClick={download}>
          Download
        </Button>
        <Button size="sm" onClick={onClose}>
          I saved them
        </Button>
      </div>
    </div>
  );
}

function DisablePanel({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { user } = useAuth();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const { run, pending, error, fields } = useSubmit(async () => {
    await api("/auth/2fa/disable", {
      method: "POST",
      json: { code, ...(user?.hasPassword ? { password } : {}) },
    });
    onDone();
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
      noValidate
      className="grid gap-4"
    >
      {user?.hasPassword && (
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      )}
      <Input
        label="Current 6-digit code"
        inputMode="numeric"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        error={fields.code}
      />
      <FormError message={error} />
      <div className="flex gap-3">
        <Button type="submit" variant="danger" loading={pending}>
          Turn off
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function SecuritySection() {
  const { user, reload } = useAuth();
  const [step, setStep] = useState<Step>({ kind: "idle" });

  const begin = useSubmit(async () => {
    const res = await api<{ secret: string; otpauthUrl: string }>("/auth/2fa/setup", {
      method: "POST",
      json: {},
    });
    setStep({ kind: "enrolling", ...res });
  });

  if (!user) return null;
  const finish = async () => {
    await reload();
    setStep({ kind: "idle" });
  };

  return (
    <Window title="Security" tone="danger">
      <div className="mb-3 flex items-center gap-3">
        <span className="pq-label">Two-factor authentication</span>
        <Chip tone={user.twoFactorEnabled ? "easy" : "neutral"}>
          {user.twoFactorEnabled ? "On" : "Off"}
        </Chip>
      </div>

      {step.kind === "idle" && !user.twoFactorEnabled && (
        <>
          <p className="mt-0">Protect your account with a code from your phone when you sign in.</p>
          <FormError message={begin.error} />
          <Button size="sm" loading={begin.pending} onClick={() => void begin.run()}>
            Set up
          </Button>
        </>
      )}
      {step.kind === "idle" && user.twoFactorEnabled && (
        <Button size="sm" variant="ghost" onClick={() => setStep({ kind: "disabling" })}>
          Turn off
        </Button>
      )}
      {step.kind === "enrolling" && (
        <SetupPanel
          secret={step.secret}
          otpauthUrl={step.otpauthUrl}
          onCancel={() => setStep({ kind: "idle" })}
          onDone={(codes) => {
            void reload();
            setStep({ kind: "codes", codes });
          }}
        />
      )}
      {step.kind === "codes" && <RecoveryCodes codes={step.codes} onClose={() => void finish()} />}
      {step.kind === "disabling" && (
        <DisablePanel onCancel={() => setStep({ kind: "idle" })} onDone={() => void finish()} />
      )}
    </Window>
  );
}
