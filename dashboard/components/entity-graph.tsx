"use client";

import * as d3 from "d3";
import { useEffect, useMemo, useState } from "react";

import { api, type Flow } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  loadEntities,
  lookupEntity,
  type EntityCategory,
  type EntityEntry,
} from "@/lib/entities";
import { fmtUsd } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";

// Category-aggregated chord diagram. Force-directed layout was wrong for this
// data (heavily hierarchical: a few hubs + thousands of unknown leaves). Chord
// shows category-to-category flows directly, which is what anyone reading
// this section actually wants to know.

const CATEGORY_ORDER: EntityCategory[] = [
  "cex",
  "dex",
  "lending",
  "stablecoin_issuer",
  "bridge",
  "mev",
  "unknown",
];

const CATEGORY_LABEL: Record<EntityCategory, string> = {
  cex: "CEX",
  dex: "DEX",
  lending: "Lending",
  stablecoin_issuer: "Issuer",
  bridge: "Bridge",
  mev: "MEV",
  treasury: "Treasury",
  zero: "Mint/Burn",
  other: "Other",
  unknown: "Unknown EOA",
};

// Tight palette — cyan family for productive, amber for risky, neutrals for unknown
const CATEGORY_HUE: Record<EntityCategory, string> = {
  cex: "#00d4aa",
  dex: "#19c39e",
  lending: "#4ec9b0",
  stablecoin_issuer: "#7fd9c1",
  bridge: "#ff6b35",
  mev: "#ff8c5a",
  treasury: "#7fd9c1",
  zero: "#ff8c5a",
  other: "rgba(237, 237, 237, 0.5)",
  unknown: "rgba(237, 237, 237, 0.35)",
};

const SIZE = 760;
const RADIUS = SIZE / 2 - 110; // leave room for labels
const ARC_WIDTH = 14;

type Aggregated = {
  matrix: number[][];
  totals: number[];
  grandTotal: number;
};

function aggregateByCategory(
  flows: Flow[],
  labels: Record<string, EntityEntry>,
): Aggregated {
  const n = CATEGORY_ORDER.length;
  const matrix: number[][] = Array.from({ length: n }, () =>
    new Array(n).fill(0),
  );
  let grand = 0;
  const unknownIdx = CATEGORY_ORDER.indexOf("unknown");

  for (const f of flows) {
    const usd = f.amount_usd || 0;
    if (usd <= 0) continue;
    const fromCat = collapseCategory(
      lookupEntity(labels, f.from_addr).category,
    );
    const toCat = collapseCategory(lookupEntity(labels, f.to_addr).category);
    const i = CATEGORY_ORDER.indexOf(fromCat);
    const j = CATEGORY_ORDER.indexOf(toCat);
    if (i < 0 || j < 0) continue;
    // Drop unknown → unknown noise. We can't classify either side, so the
    // flow contributes nothing to the "where does labeled activity go" story
    // and would otherwise consume ~99% of the chord.
    if (i === unknownIdx && j === unknownIdx) continue;
    matrix[i][j] += usd;
    grand += usd;
  }
  const totals = matrix.map((row, i) => {
    let sum = 0;
    for (let j = 0; j < row.length; j++) sum += row[j] + matrix[j][i];
    return sum;
  });
  return { matrix, totals, grandTotal: grand };
}

function collapseCategory(cat: string): EntityCategory {
  const c = cat as EntityCategory;
  if (c === "treasury" || c === "zero") return "stablecoin_issuer";
  if (c === "other") return "unknown";
  if (CATEGORY_ORDER.includes(c)) return c;
  return "unknown";
}

export function EntityGraph() {
  const { data, error } = usePoll<{ flows: Flow[] }>(
    () => api.flowsLatest(500),
    6000,
  );
  const flows = data?.flows ?? [];
  const [labels, setLabels] = useState<Record<string, EntityEntry> | null>(
    null,
  );
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    loadEntities().then(setLabels);
  }, []);

  const agg = useMemo(() => {
    if (!labels) return null;
    return aggregateByCategory(flows, labels);
  }, [flows, labels]);

  const chord = useMemo(() => {
    if (!agg) return null;
    if (agg.grandTotal === 0) return null;
    const layout = d3
      .chord()
      .padAngle(0.04)
      .sortGroups(d3.descending)
      .sortSubgroups(d3.descending);
    return layout(agg.matrix);
  }, [agg]);

  const arcGen = useMemo(
    () =>
      d3
        .arc<d3.ChordGroup>()
        .innerRadius(RADIUS)
        .outerRadius(RADIUS + ARC_WIDTH),
    [],
  );
  const ribbonGen = useMemo(
    () =>
      d3
        .ribbon<d3.Chord, d3.ChordSubgroup>()
        .radius(RADIUS - 2),
    [],
  );

  return (
    <section className="w-full px-6 py-12 sm:px-10 lg:px-16 border-b border-line">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-end justify-between border-b border-line pb-4 gap-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="size-1.5 bg-signal animate-pulse" />
              <span className="text-[10px] uppercase tracking-[0.22em] text-muted font-mono">
                Flow chord
              </span>
            </div>
            <h2 className="text-2xl tracking-tight">
              Flows that touch a labeled entity
            </h2>
            <p className="mt-1 text-xs text-muted max-w-xl">
              Aggregated from the last 500 classified mainnet flows. Random
              EOA-to-EOA traffic is filtered out — only flows where at least
              one counterparty is a known CEX / DEX / Bridge / Lending /
              Issuer / MEV are charted. Hover an arc to isolate its flows.
            </p>
          </div>
          <div className="hidden md:flex flex-col items-end gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
            <span>total tracked</span>
            <span className="text-foreground text-base normal-case tracking-normal">
              {fmtUsd(agg?.grandTotal ?? 0)}
            </span>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-px bg-line">
          <div className="bg-background relative aspect-square w-full max-w-[760px] mx-auto">
            <svg
              viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`}
              className="block w-full h-auto"
            >
              <defs>
                <filter id="arc-glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Faint outer guide ring */}
              <circle
                r={RADIUS + ARC_WIDTH + 14}
                fill="none"
                stroke="rgba(237, 237, 237, 0.05)"
                strokeWidth={0.5}
              />

              {chord && (
                <>
                  {/* Ribbons (flows) */}
                  <g>
                    {chord.map((c, i) => {
                      const path = ribbonGen(c) as unknown as string | null;
                      if (!path) return null;
                      const sourceCat = CATEGORY_ORDER[c.source.index];
                      const colour = CATEGORY_HUE[sourceCat];
                      const dim =
                        hover !== null &&
                        hover !== c.source.index &&
                        hover !== c.target.index;
                      return (
                        <path
                          key={`r-${i}`}
                          d={path}
                          fill={colour}
                          fillOpacity={dim ? 0.04 : 0.32}
                          stroke={colour}
                          strokeOpacity={dim ? 0.08 : 0.6}
                          strokeWidth={0.5}
                          style={{
                            transition:
                              "fill-opacity 0.3s ease, stroke-opacity 0.3s ease",
                          }}
                        />
                      );
                    })}
                  </g>

                  {/* Category arcs */}
                  <g>
                    {chord.groups.map((g) => {
                      const cat = CATEGORY_ORDER[g.index];
                      const colour = CATEGORY_HUE[cat];
                      const path = arcGen(g);
                      if (!path) return null;
                      const dim = hover !== null && hover !== g.index;
                      const mid = (g.startAngle + g.endAngle) / 2;
                      const arcAngle = g.endAngle - g.startAngle;
                      // Hide perimeter labels for tiny arcs — they overlap into
                      // illegible clusters. The right rail surfaces them all.
                      const showLabel = arcAngle > 0.08; // ~4.5°
                      const labelRadius = RADIUS + ARC_WIDTH + 26;
                      const lx = Math.sin(mid) * labelRadius;
                      const ly = -Math.cos(mid) * labelRadius;
                      const labelAnchor =
                        Math.sin(mid) > 0.05
                          ? "start"
                          : Math.sin(mid) < -0.05
                            ? "end"
                            : "middle";
                      const total = (agg?.totals[g.index] ?? 0) / 2; // matrix is double-counted in totals
                      return (
                        <g
                          key={`g-${g.index}`}
                          onMouseEnter={() => setHover(g.index)}
                          onMouseLeave={() => setHover(null)}
                          style={{ cursor: "pointer" }}
                        >
                          <path
                            d={path}
                            fill={colour}
                            fillOpacity={dim ? 0.2 : 0.95}
                            stroke={colour}
                            strokeOpacity={1}
                            strokeWidth={0.5}
                            filter="url(#arc-glow)"
                            style={{
                              transition: "fill-opacity 0.3s ease",
                            }}
                          />
                          {showLabel && (
                            <>
                              <text
                                x={lx}
                                y={ly}
                                textAnchor={labelAnchor}
                                dominantBaseline="middle"
                                fill={
                                  dim
                                    ? "rgba(237,237,237,0.35)"
                                    : "rgba(237,237,237,0.92)"
                                }
                                fontFamily="var(--font-sans, sans-serif)"
                                fontSize={13}
                                style={{ transition: "fill 0.3s ease" }}
                              >
                                {CATEGORY_LABEL[cat]}
                              </text>
                              <text
                                x={lx}
                                y={ly + 14}
                                textAnchor={labelAnchor}
                                dominantBaseline="middle"
                                fill={
                                  dim
                                    ? "rgba(237,237,237,0.2)"
                                    : "rgba(237,237,237,0.55)"
                                }
                                fontFamily="var(--font-mono, monospace)"
                                fontSize={10}
                                style={{ transition: "fill 0.3s ease" }}
                              >
                                {fmtUsd(total)}
                              </text>
                            </>
                          )}
                        </g>
                      );
                    })}
                  </g>

                  {/* Center stat */}
                  <g>
                    <text
                      textAnchor="middle"
                      dominantBaseline="middle"
                      y={-10}
                      fill="rgba(237,237,237,0.35)"
                      fontFamily="var(--font-mono, monospace)"
                      fontSize={10}
                      letterSpacing="0.22em"
                    >
                      LABELED-TOUCHING USD VOLUME
                    </text>
                    <text
                      textAnchor="middle"
                      dominantBaseline="middle"
                      y={18}
                      fill="rgba(237,237,237,0.95)"
                      fontFamily="var(--font-mono, monospace)"
                      fontSize={26}
                    >
                      {fmtUsd(agg?.grandTotal ?? 0)}
                    </text>
                  </g>
                </>
              )}

              {(!chord || (agg && agg.grandTotal === 0)) && !error && (
                <text
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="rgba(237,237,237,0.4)"
                  fontFamily="var(--font-mono, monospace)"
                  fontSize={11}
                >
                  Aggregating flows…
                </text>
              )}
            </svg>
          </div>

          {/* Right rail: per-category breakdown */}
          <aside className="bg-background border-t lg:border-t-0 lg:border-l border-line p-5 flex flex-col gap-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              Categories
            </div>
            <div className="flex flex-col gap-3">
              {CATEGORY_ORDER.map((cat, i) => {
                const total = (agg?.totals[i] ?? 0) / 2;
                const pct =
                  agg && agg.grandTotal > 0
                    ? Math.max(2, Math.round((100 * total) / agg.grandTotal))
                    : 0;
                const dim = hover !== null && hover !== i;
                return (
                  <div
                    key={cat}
                    className={cn(
                      "flex flex-col gap-1.5 cursor-pointer",
                      dim && "opacity-40",
                    )}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="size-2"
                          style={{ background: CATEGORY_HUE[cat] }}
                        />
                        <span className="font-mono text-xs">
                          {CATEGORY_LABEL[cat]}
                        </span>
                      </div>
                      <span className="font-mono text-xs tabular-nums">
                        {fmtUsd(total)}
                      </span>
                    </div>
                    <div className="relative h-[3px] bg-foreground/[0.06]">
                      <div
                        className="absolute inset-y-0 left-0"
                        style={{
                          width: `${pct}%`,
                          background: CATEGORY_HUE[cat],
                          opacity: 0.7,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 pt-4 border-t border-line font-mono text-[10px] text-faint leading-relaxed">
              Hover any arc or category to isolate its flows. Categories with
              the same colour family are productive (cyan: cex, dex, lending,
              issuer); amber categories carry elevated risk signals (bridge,
              mev). Unknown EOAs are the long tail that the heuristic
              classifier scrutinises hardest.
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
