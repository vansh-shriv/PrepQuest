"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  buttonClasses,
  Checkbox,
  Chip,
  FolderCard,
  LoadingBar,
  SearchPill,
  Select,
  Sprite,
  StatusBox,
  Window,
} from "@prepquest/ui";
import type {
  ProblemListItem,
  ProblemListResponse,
  SheetDetail,
  SheetSummary,
  TagFacets,
} from "@prepquest/shared";
import {
  activeFilterCount,
  readParams,
  toggle,
  toQueryString,
  type ListParams,
} from "@/features/problems/list-params";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const TOPIC_LABEL = (slug: string) => slug.replace(/-/g, " ");

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="m-0 grid gap-0 border-0 p-0">
      <legend className="pq-label mb-1 p-0">{title}</legend>
      {children}
    </fieldset>
  );
}

function Row({ item }: { item: ProblemListItem }) {
  return (
    <li className="pq-card pq-box flex flex-wrap items-center gap-3 !p-3" data-testid="problem-row">
      {item.status ? <StatusBox status={item.status} /> : null}
      <Link
        href={`/problems/${item.slug}`}
        className="min-w-[10rem] flex-1 text-base font-semibold underline-offset-4 hover:underline"
      >
        {item.title}
      </Link>
      <Chip tone={item.difficulty}>{item.difficulty}</Chip>
      <span className="hidden flex-wrap gap-1 md:flex">
        {item.topics.slice(0, 3).map((t) => (
          <Chip key={t} tone="info">
            {TOPIC_LABEL(t)}
          </Chip>
        ))}
      </span>
      <span className="pq-font-pixel w-12 text-right text-xl" title="Acceptance rate">
        {item.acceptanceRate > 0 ? `${Math.round(item.acceptanceRate)}%` : "-"}
      </span>
      <Link
        href={`/problems/${item.slug}`}
        className={buttonClasses({ size: "sm", variant: "accent" })}
        aria-label={`Play ${item.title}`}
      >
        Play
      </Link>
    </li>
  );
}

export function ProblemList() {
  const { status: authStatus } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useMemo(
    () => readParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const queryString = toQueryString(params);

  const [facets, setFacets] = useState<TagFacets | null>(null);
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  const [sheet, setSheet] = useState<SheetDetail | null>(null);
  const [items, setItems] = useState<ProblemListItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const request = useRef(0);

  const update = useCallback(
    (patch: Partial<ListParams>) => {
      const qs = toQueryString({ ...params, ...patch });
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // facets and sheets load once
  useEffect(() => {
    void api<TagFacets>("/tags")
      .then(setFacets)
      .catch(() => setFacets({ topics: [], patterns: [] }));
    void api<{ items: SheetSummary[] }>("/sheets")
      .then((r) => setSheets(r.items))
      .catch(() => setSheets([]));
  }, []);

  // keep the search box in step with the URL (back/forward, clear), and debounce typing into it
  useEffect(() => setSearch(params.q), [params.q]);
  useEffect(() => {
    if (search.trim() === params.q.trim()) return;
    const timer = setTimeout(() => update({ q: search }), 300);
    return () => clearTimeout(timer);
  }, [search, params.q, update]);

  // first page whenever the filters change
  useEffect(() => {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    api<ProblemListResponse>(`/problems?${queryString}`)
      .then((r) => {
        if (id !== request.current) return;
        setItems(r.items);
        setTotal(r.total);
        setNext(r.nextCursor);
      })
      .catch(() => id === request.current && setError("Couldn't load problems. Try again."))
      .finally(() => id === request.current && setLoading(false));
  }, [queryString, authStatus]);

  useEffect(() => {
    if (!params.sheet) {
      setSheet(null);
      return;
    }
    void api<SheetDetail>(`/sheets/${params.sheet}`)
      .then(setSheet)
      .catch(() => setSheet(null));
  }, [params.sheet]);

  const loadMore = async () => {
    if (!next) return;
    setLoadingMore(true);
    try {
      const r = await api<ProblemListResponse>(
        `/problems?${queryString}${queryString ? "&" : ""}cursor=${encodeURIComponent(next)}`,
      );
      setItems((prev) => [...prev, ...r.items]);
      setNext(r.nextCursor);
    } catch {
      setError("Couldn't load more. Try again.");
    } finally {
      setLoadingMore(false);
    }
  };

  const filters = activeFilterCount(params);

  const filterPanel = (
    <div className="grid gap-5">
      <FilterGroup title="Difficulty">
        {(["easy", "medium", "hard"] as const).map((d) => (
          <Checkbox
            key={d}
            label={d[0]!.toUpperCase() + d.slice(1)}
            checked={params.difficulty.includes(d)}
            onChange={() => update({ difficulty: toggle(params.difficulty, d) })}
          />
        ))}
      </FilterGroup>
      {authStatus === "authed" ? (
        <FilterGroup title="Your progress">
          {(["unsolved", "attempted", "solved"] as const).map((s) => (
            <Checkbox
              key={s}
              label={s[0]!.toUpperCase() + s.slice(1)}
              checked={params.status.includes(s)}
              onChange={() => update({ status: toggle(params.status, s) })}
            />
          ))}
        </FilterGroup>
      ) : null}
      <FilterGroup title="Topics">
        <Select
          label="Match"
          value={params.topicMode}
          onChange={(e) => update({ topicMode: e.target.value as "any" | "all" })}
          className="mb-2"
        >
          <option value="any">Any selected topic</option>
          <option value="all">All selected topics</option>
        </Select>
        <div className="max-h-64 overflow-auto">
          {(facets?.topics ?? []).map((t) => (
            <Checkbox
              key={t.slug}
              label={`${TOPIC_LABEL(t.slug)} (${t.count})`}
              checked={params.topic.includes(t.slug)}
              onChange={() => update({ topic: toggle(params.topic, t.slug) })}
            />
          ))}
        </div>
      </FilterGroup>
      {(facets?.patterns.length ?? 0) > 0 ? (
        <FilterGroup title="Patterns">
          {facets!.patterns.map((t) => (
            <Checkbox
              key={t.slug}
              label={`${TOPIC_LABEL(t.slug)} (${t.count})`}
              checked={params.pattern.includes(t.slug)}
              onChange={() => update({ pattern: toggle(params.pattern, t.slug) })}
            />
          ))}
        </FilterGroup>
      ) : null}
      <Select
        label="Sort by"
        value={params.sort}
        onChange={(e) => update({ sort: e.target.value as ListParams["sort"] })}
      >
        <option value="default">Recommended order</option>
        <option value="difficulty">Difficulty</option>
        <option value="acceptance">Acceptance</option>
        <option value="recent">Recently added</option>
      </Select>
      {filters > 0 ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => router.replace(pathname, { scroll: false })}
        >
          Clear filters ({filters})
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="grid gap-6">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">Quests</h1>

      {sheets.length > 0 && !params.sheet ? (
        <section aria-labelledby="sheets-h" className="grid gap-3">
          <h2 id="sheets-h" className="pq-font-ui m-0 text-sm uppercase">
            Curated sheets
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sheets.map((s) => (
              <FolderCard
                key={s.slug}
                title={s.title}
                meta={s.solved !== null ? `${s.solved} / ${s.total} solved` : `${s.total} problems`}
                progress={s.solved !== null && s.total > 0 ? (s.solved / s.total) * 100 : undefined}
                onClick={() => update({ sheet: s.slug })}
              />
            ))}
          </div>
        </section>
      ) : null}

      {params.sheet && sheet ? (
        <Window title={sheet.title} tone="coin" onClose={() => update({ sheet: "" })}>
          {sheet.description ? <p className="mt-0">{sheet.description}</p> : null}
          <LoadingBar
            label={`${sheet.title} progress`}
            value={
              sheet.solved !== null && sheet.total > 0 ? (sheet.solved / sheet.total) * 100 : 0
            }
            size="sm"
          />
          <p className="m-0 mt-2 text-sm">
            {sheet.solved !== null
              ? `${sheet.solved} of ${sheet.total} solved`
              : `${sheet.total} problems`}
          </p>
        </Window>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <aside
          aria-label="Filters"
          className="lg:sticky lg:top-[73px] lg:max-h-[calc(100dvh-90px)] lg:self-start lg:overflow-auto"
        >
          <Button
            className="lg:hidden"
            size="sm"
            variant="ghost"
            aria-expanded={filtersOpen}
            aria-controls="filter-panel"
            onClick={() => setFiltersOpen((o) => !o)}
          >
            Filters{filters ? ` (${filters})` : ""}
          </Button>
          {/* one panel for every screen size: collapsed behind the button on small screens only */}
          <div
            id="filter-panel"
            className={`${filtersOpen ? "mt-4 block" : "hidden"} lg:mt-0 lg:block`}
          >
            {filterPanel}
          </div>
        </aside>

        <section aria-label="Problems" className="grid content-start gap-4">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: search });
            }}
          >
            <SearchPill
              label="Search problems"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>

          <p
            role="status"
            aria-live="polite"
            className="pq-font-pixel m-0 text-xl"
            data-testid="result-count"
          >
            {loading
              ? "Searching..."
              : total === null
                ? ""
                : `${total} ${total === 1 ? "quest" : "quests"}`}
          </p>

          {error ? (
            <Window title="Error" tone="danger">
              {error}
            </Window>
          ) : null}

          {!loading && items.length === 0 && !error ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Sprite name="dino" scale={5} label="Dino" />
              <p className="pq-font-pixel m-0 text-2xl">NOTHING HERE YET. TRY FEWER FILTERS!</p>
              {filters > 0 ? (
                <Button size="sm" onClick={() => router.replace(pathname, { scroll: false })}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          ) : (
            <ul
              className="m-0 grid list-none gap-3 p-0"
              aria-label="Problem list"
              aria-busy={loading}
            >
              {items.map((item) => (
                <Row key={item.slug} item={item} />
              ))}
            </ul>
          )}

          {next ? (
            <div>
              <Button variant="ghost" loading={loadingMore} onClick={() => void loadMore()}>
                Load more
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
