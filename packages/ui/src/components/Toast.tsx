"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cx } from "../lib/cx";
import { Sprite } from "./Sprite";

export interface ToastOptions {
  message: string;
  tone?: "default" | "success" | "error";
  /** Show the spinning XP coin (for XP gains). */
  coin?: boolean;
  /** ms before auto-dismiss. Default 4000. */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

const ToastContext = createContext<((opts: ToastOptions) => void) | null>(null);

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast must be used inside <ToastProvider>");
  return push;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((opts: ToastOptions) => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { ...opts, id }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), opts.duration ?? 4000);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pq-toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pq-toast pq-box pq-lift",
              t.tone === "success" && "pq-toast--success",
              t.tone === "error" && "pq-toast--error",
            )}
          >
            {t.coin ? <Sprite name="coin" scale={2} animate /> : null}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
