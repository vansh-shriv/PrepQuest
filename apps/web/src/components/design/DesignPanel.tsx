"use client";

import { useMemo } from "react";
import { Textarea } from "@prepquest/ui";
import {
  DEFAULT_LOAD_ESTIMATE,
  estimateLoad,
  type LoadEstimateInput,
} from "@prepquest/analytics-core";
import type { PanelDraft } from "@/features/design/use-design";

const FIELDS: Array<{ key: keyof LoadEstimateInput; label: string; unit?: string }> = [
  { key: "dau", label: "Daily active users" },
  { key: "actionsPerUser", label: "Actions per user per day" },
  { key: "readWriteRatio", label: "Reads for every write" },
  { key: "bytesPerWrite", label: "Bytes per stored item" },
  { key: "bytesPerRead", label: "Bytes per response" },
  { key: "retentionYears", label: "Years of data kept" },
  { key: "peakFactor", label: "Peak as a multiple of average" },
];

const nf = (n: number) =>
  n >= 1000 ? Math.round(n).toLocaleString("en-US") : String(Math.round(n * 100) / 100);

/** The structured side panel (C3): requirements, capacity calculator, API list, data model and notes. */
export function DesignPanel({
  panel,
  onChange,
  hints,
}: {
  panel: PanelDraft;
  onChange: (next: PanelDraft) => void;
  hints?: { functional: string[]; nonFunctional: string[] };
}) {
  const input: LoadEstimateInput = { ...DEFAULT_LOAD_ESTIMATE, ...panel.estimate };
  const result = useMemo(() => estimateLoad(input), [input]);
  const set = (patch: Partial<PanelDraft>) => onChange({ ...panel, ...patch });

  return (
    <div className="grid gap-4" data-testid="design-panel">
      <div className="grid gap-3 md:grid-cols-2">
        <Textarea
          label="Functional requirements"
          rows={5}
          value={panel.functional}
          helper="One per line. What must the system do?"
          onChange={(e) => set({ functional: e.target.value })}
        />
        <Textarea
          label="Non-functional requirements"
          rows={5}
          value={panel.nonFunctional}
          helper="One per line. Latency, availability, consistency, scale."
          onChange={(e) => set({ nonFunctional: e.target.value })}
        />
      </div>
      {hints && (
        <details className="text-sm">
          <summary className="cursor-pointer underline">Questions to think about</summary>
          <ul className="m-0 mt-2 pl-5">
            {[...hints.functional, ...hints.nonFunctional].map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </details>
      )}

      <fieldset className="m-0 grid gap-3 border-0 p-0" data-testid="estimates">
        <legend className="pq-font-ui mb-1 text-xs uppercase">Capacity estimate</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FIELDS.map((f) => (
            <label key={f.key} className="pq-label grid gap-1">
              {f.label}
              <input
                className="pq-input"
                type="number"
                min={0}
                value={panel.estimate[f.key] ?? DEFAULT_LOAD_ESTIMATE[f.key]}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  set({
                    estimate: { ...panel.estimate, [f.key]: Number.isFinite(v) && v >= 0 ? v : 0 },
                  });
                }}
              />
            </label>
          ))}
        </div>
        <dl
          className="m-0 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2"
          data-testid="estimate-result"
        >
          <div className="flex justify-between gap-2">
            <dt>Average load</dt>
            <dd className="m-0">{nf(result.avgQps)} requests/s</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Peak load</dt>
            <dd className="m-0">{nf(result.peakQps)} requests/s</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Reads / writes</dt>
            <dd className="m-0">
              {nf(result.readQps)} / {nf(result.writeQps)} per s
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>New data</dt>
            <dd className="m-0">{nf(result.storagePerDayGB)} GB a day</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Total storage</dt>
            <dd className="m-0">{nf(result.storageTotalTB)} TB</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Peak bandwidth out</dt>
            <dd className="m-0">{nf(result.bandwidthMbps)} Mbit/s</dd>
          </div>
        </dl>
      </fieldset>

      <div className="grid gap-3 md:grid-cols-2">
        <Textarea
          label="API"
          rows={5}
          value={panel.apis}
          helper="One endpoint or call per line, e.g. POST /links"
          onChange={(e) => set({ apis: e.target.value })}
        />
        <Textarea
          label="Data model"
          rows={5}
          value={panel.dataModel}
          helper="Tables or documents, keys and the main access paths"
          onChange={(e) => set({ dataModel: e.target.value })}
        />
      </div>
      <Textarea
        label="Deep dives and trade-offs"
        rows={5}
        value={panel.notes}
        helper="What did you choose, what did you give up, and why?"
        onChange={(e) => set({ notes: e.target.value })}
      />
    </div>
  );
}
