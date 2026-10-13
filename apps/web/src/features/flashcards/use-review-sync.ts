"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SyncResponse } from "@prepquest/shared";
import { api, ApiError } from "@/lib/api";
import { readLocal, writeLocal } from "@/lib/local-store";
import { flushQueue, ReviewQueue, type KeyValueStore, type QueuedReview } from "./offline";

export const browserStore: KeyValueStore = { read: readLocal, write: writeLocal };

const RETRY_MS = 20_000;

/**
 * The review queue of one learner: answers are written to the device first, and sent whenever the browser
 * is online. Flushes on load, when the connection returns, after each answer and every 20 s while waiting.
 */
export function useReviewSync(userId: string | undefined) {
  const queue = useMemo(() => (userId ? new ReviewQueue(browserStore, userId) : null), [userId]);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [synced, setSynced] = useState(0);
  const busy = useRef(false);

  const flush = useCallback(async () => {
    if (!queue || busy.current || queue.size() === 0) return;
    busy.current = true;
    try {
      const result = await flushQueue(
        queue,
        (reviews) => api<SyncResponse>("/flashcards/sync", { method: "POST", json: { reviews } }),
        (err) => err instanceof ApiError && err.status === 422,
      );
      if (result.sent > 0) setSynced((n) => n + result.sent);
    } finally {
      busy.current = false;
      setPending(queue.size());
    }
  }, [queue]);

  const record = useCallback(
    (review: QueuedReview) => {
      if (!queue) return;
      queue.add(review);
      setPending(queue.size());
      void flush();
    },
    [queue, flush],
  );

  useEffect(() => {
    setOnline(navigator.onLine);
    setPending(queue?.size() ?? 0);
    void flush();
    const up = () => {
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const timer = setInterval(() => void flush(), RETRY_MS);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      clearInterval(timer);
    };
  }, [queue, flush]);

  return { queue, pending, online, synced, record, flush };
}
