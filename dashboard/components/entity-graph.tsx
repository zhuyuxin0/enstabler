"use client";

import { useEffect, useMemo, useState } from "react";

import { api, type Flow } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  CATEGORY_COLOR,
  loadEntities,
  lookupEntity,
  type EntityCategory,
  type EntityEntry,
} from "@/lib/entities";
import { fmtCount, fmtUsd, shortAddr } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";

// Three iterations on graph-style visuals (force-directed, then chord) failed
// because the underlying data is hub-and-spoke, not a network: ~80 labeled
// entities in a sea of millions of unlabeled wallets. Anything that allocates
// space proportional to volume gives Unknown EOA the entire canvas.
//
// What actually answers "where is the agent's attention?" is a ranked list
// of labeled entities by USD volume. That's what this component shows.

const CATEGORY_LABEL: Record<EntityCategory, string> = {
  cex: "CEX",
  dex: "DEX",
  lending: "Lending",
  stablecoin_issuer: "Issuer",
  treasury: "Treasury",
  bridge: "Bridge",
  mev: "MEV",
  zero: "Mint/Burn",
  other: "Other",
  unknown: "Unknown",
};

type EntityRow = {
  addr: string;
  name: string;
  category: EntityCategory;
  volume: number;
  count: number;
  inFlows: number;
  outFlows: number;
};

type CategoryTotal = {
  category: EntityCategory;
  volume: number;
  count: number;
};

const TOP_N = 12;

export function EntityGraph() {
  const { data, error } = usePoll<{ flows: Flow[] }>(
    () => api.flowsLatest(500),
    6000,
  );
  const flows = data?.flows ?? [];
  const [labels, setLabels] = useState<Record<string, EntityEntry> | null>(
    null,
  );

  useEffect(() => {
    loadEntities().then(setLabels);
  }, []);

  const { topEntities, byCategory, totalLabeled, totalAll, labeledShare } =
    useMemo(() => {
      const empty = {
        topEntities: [] as EntityRow[],
        byCategory: [] as CategoryTotal[],
        totalLabeled: 0,
        totalAll: 0,
        labeledShare: 0,
      };
      if (!labels) return empty;

      const entityMap = new Map<string, EntityRow>();
      const categoryMap = new Map<EntityCategory, CategoryTotal>();
      let labeledTotal = 0;
      let total = 0;

      for (const f of flows) {
        const usd = f.amount_usd || 0;
        if (usd <= 0) continue;
        total += usd;

        const fromEntry = lookupEntity(labels, f.from_addr);
        const toEntry = lookupEntity(labels, f.to_addr);

        const sides: Array<[string, EntityEntry, "out" | "in"]> = [
          [(f.from_addr || "").toLowerCase(), fromEntry, "out"],
          [(f.to_addr || "").toLowerCase(), toEntry, "in"],
        ];

        let touched = false;
        for (const [a, entry, dir] of sides) {
          if (!a || entry.category === "unknown") continue;
          touched = true;
          if (!entityMap.has(a)) {
            entityMap.set(a, {
              addr: a,
              name: entry.name,
              category: entry.category,
              volume: 0,
              count: 0,
              inFlows: 0,
              outFlows: 0,
            });
          }
          const row = entityMap.get(a)!;
          row.volume += usd;
          row.count += 1;
          if (dir === "out") row.outFlows += 1;
          else row.inFlows += 1;
        }

        if (touched) {
          labeledTotal += usd;
          // Category aggregation: count this flow once per unique labeled
          // category that appears on either side.
          const cats = new Set<EntityCategory>();
          if (fromEntry.category !== "unknown") cats.add(fromEntry.category);
          if (toEntry.category !== "unknown") cats.add(toEntry.category);
          for (const c of cats) {
            if (!categoryMap.has(c)) {
              categoryMap.set(c, { category: c, volume: 0, count: 0 });
            }
            const ct = categoryMap.get(c)!;
            ct.volume += usd;
            ct.count += 1;
          }
        }
      }

      const top = [...entityMap.values()]
        .sort((a, b) => b.volume - a.volume)
        .slice(0, TOP_N);

      const byCat = [...categoryMap.values()].sort(
        (a, b) => b.volume - a.volume,
      );

      return {
        topEntities: top,
        byCategory: byCat,
        totalLabeled: labeledTotal,
        totalAll: total,
        labeledShare: total > 0 ? labeledTotal / total : 0,
      };
    }, [flows, labels]);

  const topVolume = topEntities[0]?.volume ?? 0;

  return (
    <section className="w-full px-6 py-12 sm:px-10 lg:px-16 border-b border-line">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-end justify-between border-b border-line pb-4 gap-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="size-1.5 bg-signal animate-pulse" />
              <span className="text-[10px] uppercase tracking-[0.22em] text-muted font-mono">
                Entity activity
              </span>
            </div>
            <h2 className="text-2xl tracking-tight">
              Where the agent&apos;s attention lands
            </h2>
            <p className="mt-1 text-xs text-muted max-w-xl">
              Top labeled counterparties by USD volume from the last 500
              classified flows. Random EOA-to-EOA traffic is the long tail
              the heuristic classifier scrutinises hardest; this section
              surfaces the structural backbone instead.
            </p>
          </div>
          <div className="hidden md:flex flex-col items-end gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
            <span>labeled-touching share</span>
            <span className="text-foreground text-base normal-case tracking-normal">
              {(labeledShare * 100).toFixed(1)}%
            </span>
            <span className="text-faint">
              {fmtUsd(totalLabeled)} of {fmtUsd(totalAll)}
            </span>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-px bg-line">
          {/* Leaderboard */}
          <div className="bg-background">
            <div
              className="grid border-b border-line bg-foreground/[0.012] font-mono text-[10px] uppercase tracking-[0.18em] text-muted"
              style={{
                gridTemplateColumns:
                  "44px minmax(0, 1fr) 80px minmax(0, 1.2fr) 100px 60px",
              }}
            >
              <div className="px-4 py-3">#</div>
              <div className="px-4 py-3">Entity</div>
              <div className="px-4 py-3">Category</div>
              <div className="px-4 py-3">Volume</div>
              <div className="px-4 py-3 text-right">USD</div>
              <div className="px-4 py-3 text-right">Flows</div>
            </div>

            {topEntities.length === 0 ? (
              <div className="px-5 py-12 font-mono text-[11px] text-faint text-center">
                {labels === null
                  ? "loading entity labels…"
                  : flows.length === 0
                    ? error
                      ? "agent backend unreachable"
                      : "waiting for classified flows…"
                    : "no labeled counterparty appeared in the last 500 flows yet"}
              </div>
            ) : (
              topEntities.map((row, i) => {
                const colour = CATEGORY_COLOR[row.category];
                const pct =
                  topVolume > 0
                    ? Math.max(2, Math.round((100 * row.volume) / topVolume))
                    : 0;
                return (
                  <div
                    key={row.addr}
                    className={cn(
                      "grid items-center border-b border-line last:border-b-0",
                      "hover:bg-foreground/[0.025] transition-colors",
                    )}
                    style={{
                      gridTemplateColumns:
                        "44px minmax(0, 1fr) 80px minmax(0, 1.2fr) 100px 60px",
                    }}
                  >
                    <div className="px-4 py-4 font-mono text-xs text-faint tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <div className="px-4 py-4 min-w-0">
                      <div className="text-sm truncate">{row.name}</div>
                      <div className="font-mono text-[10px] text-faint truncate">
                        {shortAddr(row.addr, 6, 4)}
                      </div>
                    </div>
                    <div className="px-4 py-4">
                      <span
                        className="font-mono text-[10px] uppercase tracking-[0.16em]"
                        style={{ color: colour }}
                      >
                        {CATEGORY_LABEL[row.category]}
                      </span>
                    </div>
                    <div className="px-4 py-4">
                      <div className="relative h-[6px] bg-foreground/[0.06] overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 transition-all duration-700 ease-out"
                          style={{
                            width: `${pct}%`,
                            background: colour,
                            opacity: 0.7,
                          }}
                        />
                      </div>
                      <div className="mt-1 flex gap-2 font-mono text-[9px] text-faint">
                        <span>↓ {row.inFlows}</span>
                        <span>↑ {row.outFlows}</span>
                      </div>
                    </div>
                    <div className="px-4 py-4 font-mono text-sm tabular-nums text-right">
                      {fmtUsd(row.volume)}
                    </div>
                    <div className="px-4 py-4 font-mono text-xs tabular-nums text-right text-muted">
                      {fmtCount(row.count)}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Right rail: category breakdown */}
          <aside className="bg-background border-t lg:border-t-0 lg:border-l border-line p-5 flex flex-col gap-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              By category
            </div>
            <div className="flex flex-col gap-3">
              {byCategory.length === 0 ? (
                <div className="font-mono text-[11px] text-faint">
                  no labeled categories yet
                </div>
              ) : (
                byCategory.map((c) => {
                  const colour = CATEGORY_COLOR[c.category];
                  const pct =
                    totalLabeled > 0
                      ? Math.max(2, Math.round((100 * c.volume) / totalLabeled))
                      : 0;
                  return (
                    <div key={c.category} className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="size-2"
                            style={{ background: colour }}
                          />
                          <span className="font-mono text-xs">
                            {CATEGORY_LABEL[c.category]}
                          </span>
                        </div>
                        <span className="font-mono text-xs tabular-nums">
                          {fmtUsd(c.volume)}
                        </span>
                      </div>
                      <div className="relative h-[3px] bg-foreground/[0.06]">
                        <div
                          className="absolute inset-y-0 left-0 transition-all duration-700 ease-out"
                          style={{
                            width: `${pct}%`,
                            background: colour,
                            opacity: 0.7,
                          }}
                        />
                      </div>
                      <div className="font-mono text-[10px] text-faint">
                        {c.count} flow{c.count === 1 ? "" : "s"}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="mt-2 pt-4 border-t border-line font-mono text-[10px] text-faint leading-relaxed">
              Cyan-family categories (CEX / DEX / Lending / Issuer) are
              productive flow paths. Amber categories (Bridge / MEV) raise the
              risk floor. Total tracked volume is the share of the last 500
              flows where at least one counterparty matched a known label —
              the rest is the unlabeled long tail the classifier picks
              through.
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
