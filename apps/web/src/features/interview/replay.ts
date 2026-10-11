// Turns the stored interview events into frames for the replay scrubber (doc 03 I6, E2).

export interface RawEvent {
  id: number;
  offsetMs: number;
  kind: string;
  payload: Record<string, unknown>;
}

export interface ReplayFrame {
  offsetMs: number;
  /** The code on screen at this moment (carried forward from the last snapshot or run). */
  code: string;
  language: string;
  /** What this frame marks, if anything special happened. */
  marker: null | {
    kind: "run" | "submit" | "paste" | "focus_lost";
    label: string;
    verdict?: string;
  };
}

const text = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

export function buildReplay(events: readonly RawEvent[]): ReplayFrame[] {
  const frames: ReplayFrame[] = [];
  let code = "";
  let language = "";
  for (const e of [...events].sort((a, b) => a.offsetMs - b.offsetMs || a.id - b.id)) {
    const p = e.payload;
    if (e.kind === "code_snapshot") {
      code = text(p.code, code);
      language = text(p.language, language);
      frames.push({ offsetMs: e.offsetMs, code, language, marker: null });
    } else if (e.kind === "run" || e.kind === "submit") {
      code = text(p.code, code);
      language = text(p.language, language);
      const verdict = text(p.verdict, "?");
      const total =
        typeof p.total === "number" && p.total > 0 ? ` ${Number(p.passed ?? 0)}/${p.total}` : "";
      frames.push({
        offsetMs: e.offsetMs,
        code,
        language,
        marker: {
          kind: e.kind,
          label: `${e.kind === "submit" ? "Submit" : "Run"}: ${verdict}${total}`,
          verdict,
        },
      });
    } else if (e.kind === "paste") {
      const chars = Number(p.chars ?? 0);
      frames.push({
        offsetMs: e.offsetMs,
        code,
        language,
        marker: { kind: "paste", label: chars > 0 ? `Pasted ${chars} characters` : "Pasted text" },
      });
    } else if (e.kind === "focus_lost") {
      frames.push({
        offsetMs: e.offsetMs,
        code,
        language,
        marker: { kind: "focus_lost", label: "Left the tab" },
      });
    }
  }
  return frames;
}

/** Index of the last frame at or before `offsetMs` (-1 before the first). */
export function frameAt(frames: readonly ReplayFrame[], offsetMs: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.offsetMs <= offsetMs) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/** Added and removed line counts between two versions of the code (a rough "how much changed"). */
export function lineChange(prev: string, next: string): { added: number; removed: number } {
  const a = new Set(prev.split("\n"));
  const b = new Set(next.split("\n"));
  let added = 0;
  let removed = 0;
  for (const l of b) if (!a.has(l)) added++;
  for (const l of a) if (!b.has(l)) removed++;
  return { added, removed };
}
