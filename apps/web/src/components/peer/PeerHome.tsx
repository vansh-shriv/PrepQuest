"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button, Chip, Input, LoadingBar, Select, Window } from "@prepquest/ui";
import {
  PEER_MINUTE_VALUES,
  PEER_TOPIC_LABEL,
  PEER_TOPIC_VALUES,
  type CreatedPeerInviteDto,
  type PeerAvailabilityDto,
  type PeerInviteDto,
  type PeerReputationDto,
  type PeerSessionDetail,
  type PeerSessionItem,
  type PeerTopicValue,
} from "@prepquest/shared";
import {
  STATE_TEXT,
  defaultWindow,
  fromLocalInput,
  inviteUrl,
  reputationText,
  tokenFromInput,
  whenLabel,
} from "@/features/peer/peer-view";
import { api, ApiError } from "@/lib/api";
import { FormError } from "../auth/AuthCard";

const LEVELS = [
  { value: 1, label: "Easier" },
  { value: 2, label: "Medium" },
  { value: 3, label: "Harder" },
] as const;

const message = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

/** `/peer`: availability, finding a partner, invite links and the sessions you have booked. */
export function PeerHome() {
  const router = useRouter();
  const [windows, setWindows] = useState<PeerAvailabilityDto[] | null>(null);
  const [sessions, setSessions] = useState<PeerSessionItem[] | null>(null);
  const [invites, setInvites] = useState<PeerInviteDto[]>([]);
  const [blocks, setBlocks] = useState<{ userId: string; handle: string }[]>([]);
  const [rep, setRep] = useState<PeerReputationDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [w, s, i, b, r] = await Promise.all([
        api<{ items: PeerAvailabilityDto[] }>("/peer/availability"),
        api<{ items: PeerSessionItem[] }>("/peer/sessions"),
        api<{ items: PeerInviteDto[] }>("/peer/invites"),
        api<{ items: { userId: string; handle: string }[] }>("/peer/blocks"),
        api<PeerReputationDto>("/peer/reputation"),
      ]);
      setWindows(w.items);
      setSessions(s.items);
      setInvites(i.items);
      setBlocks(b.items);
      setRep(r);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? "Verify your email to use peer mocks: you will be talking to real people."
          : "Couldn't reach the server.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(message(err, "Something went wrong."));
    }
  };

  if (!windows || !sessions) {
    return (
      <div className="grid max-w-md gap-3">
        {error ? <FormError message={error} /> : <LoadingBar label="Loading peer mocks" />}
      </div>
    );
  }

  const upcoming = sessions.filter((s) => s.state === "scheduled" || s.state === "live");
  const past = sessions.filter((s) => s.state !== "scheduled" && s.state !== "live");

  return (
    <div className="grid max-w-5xl gap-6" data-testid="peer-home">
      <div>
        <h1 className="pq-font-display m-0 text-lg leading-relaxed">Peer mocks</h1>
        <p className="m-0 mt-1 text-sm text-ink-soft">
          Practise with another learner: one half each as interviewer and as candidate. Add the
          times you are free, find a partner, or invite a friend with a link. Calls happen on your
          own video tool for now; PrepQuest keeps the schedule, the roles, the questions and the
          clock.
        </p>
        {rep && (
          <p className="m-0 mt-2 text-sm" data-testid="peer-reputation">
            Your record: {reputationText(rep)}
          </p>
        )}
      </div>
      <FormError message={error} />
      {notice && (
        <p role="status" className="m-0" data-testid="peer-notice">
          {notice}
        </p>
      )}

      <section className="grid gap-3" aria-labelledby="ps-h">
        <h2 id="ps-h" className="pq-font-ui m-0 text-sm uppercase">
          Your sessions
        </h2>
        {upcoming.length === 0 ? (
          <p className="m-0" data-testid="peer-no-sessions">
            Nothing booked yet.
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0" data-testid="peer-sessions">
            {upcoming.map((s) => (
              <SessionRow key={s.id} s={s} />
            ))}
          </ul>
        )}
        {past.length > 0 && (
          <details>
            <summary className="cursor-pointer underline">Earlier sessions ({past.length})</summary>
            <ul className="m-0 mt-2 grid list-none gap-2 p-0">
              {past.map((s) => (
                <SessionRow key={s.id} s={s} />
              ))}
            </ul>
          </details>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Window title="Times you are free">
          <AvailabilityForm
            onAdded={() => act(async () => undefined)}
            onError={setError}
            windows={windows}
            onRemove={(id) =>
              act(() => api(`/peer/availability/${id}`, { method: "DELETE" }).then(() => undefined))
            }
          />
        </Window>

        <Window title="Find a partner" tone="sky">
          <Finder
            disabled={windows.length === 0}
            onBooked={(s) => router.push(`/peer/${s.id}`)}
            onError={setError}
          />
        </Window>
      </div>

      <Window title="Invite a friend">
        <Invites
          invites={invites}
          onChange={() => act(async () => undefined)}
          onError={setError}
          onNotice={setNotice}
          onJoin={(token) => router.push(`/peer/join/${token}`)}
        />
      </Window>

      {blocks.length > 0 && (
        <section className="grid gap-2" aria-labelledby="pb-h">
          <h2 id="pb-h" className="pq-font-ui m-0 text-sm uppercase">
            People you blocked
          </h2>
          <ul className="m-0 grid list-none gap-1 p-0">
            {blocks.map((b) => (
              <li key={b.userId} className="flex items-center gap-3">
                <span>{b.handle}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void act(() =>
                      api(`/peer/blocks/${b.userId}`, { method: "DELETE" }).then(() => undefined),
                    )
                  }
                >
                  Unblock<span className="sr-only"> {b.handle}</span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SessionRow({ s }: { s: PeerSessionItem }) {
  return (
    <li
      className="pq-box flex flex-wrap items-center gap-3 bg-surface p-3"
      data-testid="peer-session"
    >
      <Link href={`/peer/${s.id}`} className="underline">
        {PEER_TOPIC_LABEL[s.topic]} with {s.partner.handle}
      </Link>
      <span className="text-sm text-ink-soft">
        {whenLabel(s.scheduledAt)}, {s.minutes} min
      </span>
      <Chip tone={s.state === "completed" ? "easy" : s.state === "no_show" ? "hard" : "info"}>
        {STATE_TEXT[s.state]}
      </Chip>
      {s.state === "completed" && !s.feedbackGiven && <Chip tone="medium">Feedback due</Chip>}
    </li>
  );
}

function AvailabilityForm({
  windows,
  onAdded,
  onRemove,
  onError,
}: {
  windows: PeerAvailabilityDto[];
  onAdded: () => void;
  onRemove: (id: string) => void;
  onError: (m: string | null) => void;
}) {
  const [init] = useState(() => defaultWindow(new Date()));
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [topics, setTopics] = useState<PeerTopicValue[]>(["dsa"]);
  const [difficulty, setDifficulty] = useState(2);
  const [language, setLanguage] = useState("python");
  const [pending, setPending] = useState(false);

  const toggle = (t: PeerTopicValue) =>
    setTopics((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const add = async () => {
    onError(null);
    const startsAt = fromLocalInput(from);
    const endsAt = fromLocalInput(to);
    if (!startsAt || !endsAt) return onError("Pick a start and an end.");
    if (topics.length === 0) return onError("Pick at least one topic.");
    setPending(true);
    try {
      await api("/peer/availability", {
        method: "POST",
        json: { startsAt, endsAt, topics, difficulty, language },
      });
      onAdded();
    } catch (err) {
      onError(message(err, "Couldn't add the window."));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-3" data-testid="peer-availability">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          label="From"
          type="datetime-local"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          label="Until"
          type="datetime-local"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      <fieldset className="m-0 grid gap-1 border-0 p-0">
        <legend className="pq-label">Topics you can practise</legend>
        <div className="flex flex-wrap gap-3">
          {PEER_TOPIC_VALUES.map((t) => (
            <label key={t} className="flex items-center gap-2">
              <input type="checkbox" checked={topics.includes(t)} onChange={() => toggle(t)} />
              {PEER_TOPIC_LABEL[t]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          label="Level"
          value={difficulty}
          onChange={(e) => setDifficulty(Number(e.target.value))}
        >
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </Select>
        <Select label="Language" value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="python">Python</option>
          <option value="cpp">C++</option>
          <option value="java">Java</option>
        </Select>
      </div>
      <div>
        <Button size="sm" loading={pending} onClick={() => void add()}>
          Add this window
        </Button>
      </div>
      {windows.length > 0 && (
        <ul
          className="m-0 grid list-none gap-1 p-0"
          aria-label="Your open windows"
          data-testid="peer-windows"
        >
          {windows.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-2">
              <span>
                {whenLabel(w.startsAt)} to {whenLabel(w.endsAt)}
              </span>
              <span className="text-sm text-ink-soft">
                {w.topics.map((t) => PEER_TOPIC_LABEL[t]).join(", ")}
              </span>
              <Button size="sm" variant="ghost" onClick={() => onRemove(w.id)}>
                Remove<span className="sr-only"> {whenLabel(w.startsAt)}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Finder({
  disabled,
  onBooked,
  onError,
}: {
  disabled: boolean;
  onBooked: (s: PeerSessionDetail) => void;
  onError: (m: string | null) => void;
}) {
  const [minutes, setMinutes] = useState(60);
  const [pending, setPending] = useState(false);
  const [none, setNone] = useState(false);

  const find = async () => {
    onError(null);
    setNone(false);
    setPending(true);
    try {
      onBooked(await api<PeerSessionDetail>("/peer/match", { method: "POST", json: { minutes } }));
    } catch (err) {
      if (err instanceof ApiError && err.code === "NO_MATCH") setNone(true);
      else onError(message(err, "Couldn't look for a partner."));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm">
        We pair you with someone whose free time and topics overlap yours. Each of you takes one
        half.
      </p>
      <Select label="Length" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
        {PEER_MINUTE_VALUES.map((m) => (
          <option key={m} value={m}>
            {m} minutes
          </option>
        ))}
      </Select>
      <div>
        <Button loading={pending} disabled={disabled} onClick={() => void find()}>
          Find a partner
        </Button>
      </div>
      {disabled && <p className="m-0 text-sm text-ink-soft">Add a time window first.</p>}
      {none && (
        <p role="status" className="m-0" data-testid="peer-no-match">
          Nobody is free at a matching time yet. Your windows stay open: try again later, or invite
          a friend.
        </p>
      )}
    </div>
  );
}

function Invites({
  invites,
  onChange,
  onError,
  onNotice,
  onJoin,
}: {
  invites: PeerInviteDto[];
  onChange: () => void;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
  onJoin: (token: string) => void;
}) {
  const [topic, setTopic] = useState<PeerTopicValue>("dsa");
  const [difficulty, setDifficulty] = useState(2);
  const [minutes, setMinutes] = useState(60);
  const [when, setWhen] = useState(() => defaultWindow(new Date()).from);
  const [link, setLink] = useState<string | null>(null);
  const [paste, setPaste] = useState("");

  const create = async () => {
    onError(null);
    const scheduledAt = fromLocalInput(when);
    if (!scheduledAt) return onError("Pick a time.");
    try {
      const inv = await api<CreatedPeerInviteDto>("/peer/invites", {
        method: "POST",
        json: { topic, difficulty, minutes, scheduledAt },
      });
      setLink(inviteUrl(window.location.origin, inv.token));
      onChange();
    } catch (err) {
      onError(message(err, "Couldn't create the invite."));
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      onNotice("Link copied.");
    } catch {
      onNotice("Select the link and copy it.");
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          label="Topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value as PeerTopicValue)}
        >
          {PEER_TOPIC_VALUES.map((t) => (
            <option key={t} value={t}>
              {PEER_TOPIC_LABEL[t]}
            </option>
          ))}
        </Select>
        <Select
          label="Level"
          value={difficulty}
          onChange={(e) => setDifficulty(Number(e.target.value))}
        >
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </Select>
        <Select
          label="Invite length"
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
        >
          {PEER_MINUTE_VALUES.map((m) => (
            <option key={m} value={m}>
              {m} minutes
            </option>
          ))}
        </Select>
        <Input
          label="Start"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </div>
      <div>
        <Button size="sm" onClick={() => void create()}>
          Make an invite link
        </Button>
      </div>
      {link && (
        <div className="grid gap-2" data-testid="peer-invite-link">
          <p className="m-0 text-sm">
            Send this link to your friend. It is shown once and works for one person until the start
            time.
          </p>
          <code className="break-all">{link}</code>
          <div>
            <Button size="sm" variant="ghost" onClick={() => void copy()}>
              Copy the link
            </Button>
          </div>
        </div>
      )}
      {invites.length > 0 && (
        <ul
          className="m-0 grid list-none gap-1 p-0"
          aria-label="Your invites"
          data-testid="peer-invites"
        >
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2">
              <span>
                {PEER_TOPIC_LABEL[i.topic]}, {whenLabel(i.scheduledAt)}
              </span>
              <Chip
                tone={i.status === "accepted" ? "easy" : i.status === "open" ? "info" : "neutral"}
              >
                {i.status}
              </Chip>
              {i.sessionId && (
                <Link href={`/peer/${i.sessionId}`} className="underline">
                  Open the session
                </Link>
              )}
              {i.status === "open" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void api(`/peer/invites/${i.id}`, { method: "DELETE" }).then(onChange, (e) =>
                      onError(message(e, "Couldn't revoke it.")),
                    )
                  }
                >
                  Revoke<span className="sr-only"> invite for {whenLabel(i.scheduledAt)}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 border-t-[3px] border-ink pt-3">
        <Input
          label="Got an invite? Paste the link"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
        />
        <div>
          <Button
            size="sm"
            variant="ghost"
            disabled={!paste.trim()}
            onClick={() => onJoin(tokenFromInput(paste))}
          >
            Look at the invite
          </Button>
        </div>
      </div>
    </div>
  );
}
