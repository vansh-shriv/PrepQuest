"use client";

import { useState } from "react";
import { Button, buttonClasses, Checkbox, Dialog, Input, Select } from "@prepquest/ui";
import type { CreatedShareDto, SHARE_EXPIRY, ShareEntity, ShareOptions } from "@prepquest/shared";
import {
  DEFAULT_OPTIONS,
  ENTITY_LABEL,
  EXPIRY_OPTIONS,
  shareUrl,
} from "@/features/share/share-view";
import { api } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";

export interface ShareDialogProps {
  entityType: ShareEntity;
  /** Interview id, contest slug or readiness target. */
  refId?: string;
  label?: string;
}

/** Make a share link with privacy options. The link is shown once; only a hash of it is stored. */
export function ShareButton({ entityType, refId, label = "Share" }: ShareDialogProps) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ShareOptions>(DEFAULT_OPTIONS);
  const [visibility, setVisibility] = useState<"unlisted" | "public">("unlisted");
  const [expiresIn, setExpiresIn] = useState<(typeof SHARE_EXPIRY)[number]>("30d");
  const [created, setCreated] = useState<CreatedShareDto | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useSubmit(async () => {
    setCreated(
      await api<CreatedShareDto>("/shares", {
        method: "POST",
        json: { entityType, ...(refId ? { ref: refId } : {}), options, visibility, expiresIn },
      }),
    );
  });

  const set = (key: keyof ShareOptions) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setOptions((o) => ({ ...o, [key]: e.target.checked }));
  const link = created ? shareUrl(window.location.origin, created.path) : "";
  const quotes = entityType === "scorecard";

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setCreated(null);
          setCopied(false);
          create.setError(null);
        }}
        title={`Share: ${ENTITY_LABEL[entityType]}`}
        tone="sky"
      >
        {created ? (
          <div className="grid gap-3" data-testid="share-created">
            <p className="m-0">
              Your link is ready. Anyone who has it can read the report you chose. Copy it now: it
              is not shown again, but you can revoke it any time in Settings.
            </p>
            <Input label="Link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="accent"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
              <a
                className={buttonClasses({ variant: "ghost" })}
                href={created.path}
                target="_blank"
                rel="noopener noreferrer"
              >
                Preview
              </a>
            </div>
          </div>
        ) : (
          <form
            className="grid gap-3"
            data-testid="share-form"
            onSubmit={(e) => {
              e.preventDefault();
              void create.run();
            }}
          >
            <p className="m-0 text-sm">
              The page shows a summary and scores. Choose what else stays out of it. Emails, phone
              numbers and links are always removed.
            </p>
            {quotes && (
              <>
                <Checkbox
                  label="Hide quotes from the interview"
                  checked={options.hideTranscript}
                  onChange={set("hideTranscript")}
                />
                <Checkbox
                  label="Hide quotes from my code"
                  checked={options.hideCode}
                  onChange={set("hideCode")}
                />
              </>
            )}
            <Checkbox
              label={
                entityType === "readiness" ? "Hide the target company" : "Hide the company name"
              }
              checked={options.hideCompany}
              onChange={set("hideCompany")}
            />
            <Checkbox label="Hide my name" checked={options.hideName} onChange={set("hideName")} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Who can find it"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as "unlisted" | "public")}
                helper={
                  visibility === "unlisted"
                    ? "Only people with the link. Search engines are told to skip it."
                    : "Anyone with the link; search engines may list it."
                }
              >
                <option value="unlisted">Unlisted link</option>
                <option value="public">Public link</option>
              </Select>
              <Select
                label="Expires"
                value={expiresIn}
                onChange={(e) => setExpiresIn(e.target.value as (typeof SHARE_EXPIRY)[number])}
              >
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <FormError message={create.error} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="accent" loading={create.pending}>
                Create link
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
