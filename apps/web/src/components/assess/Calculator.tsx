"use client";

import { useState } from "react";
import { Button, Window } from "@prepquest/ui";
import { calcPress, INITIAL_CALC, type CalcState } from "@/features/assess/calculator";

const KEYS = [
  "7",
  "8",
  "9",
  "/",
  "4",
  "5",
  "6",
  "*",
  "1",
  "2",
  "3",
  "-",
  "0",
  ".",
  "=",
  "+",
] as const;

/** The on-screen calculator some company tests allow. Four operations, no memory. */
export function Calculator() {
  const [state, setState] = useState<CalcState>(INITIAL_CALC);
  return (
    <Window title="Calculator" tone="olive">
      <div className="grid w-56 gap-2" data-testid="calculator">
        <output
          className="pq-box block overflow-hidden p-2 text-right text-xl"
          aria-live="polite"
          aria-label="Calculator display"
          data-testid="calc-display"
        >
          {state.display}
        </output>
        <div className="grid grid-cols-4 gap-1">
          {KEYS.map((k) => (
            <Button key={k} variant="ghost" onClick={() => setState((s) => calcPress(s, k))}>
              {k}
            </Button>
          ))}
        </div>
        <Button variant="ghost" onClick={() => setState(INITIAL_CALC)}>
          Clear
        </Button>
      </div>
    </Window>
  );
}
