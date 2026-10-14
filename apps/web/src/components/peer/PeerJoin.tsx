"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, LoadingBar, Window } from "@prepquest/ui";
import {
  PEER_TOPIC_LABEL,
  type PeerInvitePreviewDto,
  type PeerSessionDetail,
} from "@prepquest/shared";
import { whenLabel } from "@/features/peer/peer-view";
import { api, ApiError } from "@/lib/api";
import { FormError } from "../auth/AuthCard";

/** `/peer/join/[token]`: what a friend sees when they open an invite link. */
export function PeerJoin({ token }: { token: string }) {
  const router = useRouter();
  const [invite, setInvite] = useState<PeerInvitePreviewDto | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api<PeerInvitePreviewDto>(`/peer/invites/${token}`)
      .then(setInvite)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setGone(true);
        else
          setError(
            err instanceof ApiError && err.status === 403
              ? "Verify your email to use peer mocks."
              : "Couldn't reach the server.",
          );
      });
  }, [token]);

  const accept = async () => {
    setError(null);
    setPending(true);
    try {
      const s = await api<PeerSessionDetail>(`/peer/invites/${token}/accept`, {
        method: "POST",
        json: {},
      });
      router.push(`/peer/${s.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't accept the invite.");
      setPending(false);
    }
  };

  return (
    <div className="grid max-w-lg gap-4" data-testid="peer-join">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">Peer mock invite</h1>
      {gone ? (
        <p role="status" className="m-0" data-testid="peer-invite-gone">
          This invite is not available. It may have been used, withdrawn or have run out.
        </p>
      ) : invite ? (
        <Window title={`${invite.owner} invited you`} tone="sky">
          <div className="grid gap-3">
            <p className="m-0">
              {PEER_TOPIC_LABEL[invite.topic]}, {invite.minutes} minutes,{" "}
              {whenLabel(invite.scheduledAt)}. You take one half each as interviewer and as
              candidate.
            </p>
            <div>
              <Button loading={pending} onClick={() => void accept()}>
                Accept and book it
              </Button>
            </div>
          </div>
        </Window>
      ) : (
        !error && <LoadingBar label="Looking up the invite" />
      )}
      <FormError message={error} />
      <Link href="/peer" className="underline">
        Back to peer mocks
      </Link>
    </div>
  );
}
