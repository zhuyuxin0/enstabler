"use client";

import { useMemo } from "react";

import { api, type Flow } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtCount } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";

const STABLES = ["USDT", "USDC", "DAI", "PYUSD"] as const;
const CLASSES = [
  "payment",
  "cex_flow",
  "arbitrage",
  "bot",
  "mint_burn",
  "suspicious",
] as const;

const CLASS_LABEL: Record<(typeof CLASSES)[number], string> = {
  payment: "Payment",
  cex_flow: "CEX",
  arbitrage: "Arbitrage",
  bot: "Bot",
  mint_burn: "Mint/Burn",
  suspicious: "Suspicious",
};

export function RiskHeatmap() {
  const { data } = usePoll<{ classifications: Flow[] }>(
    () => api.classificationsLatest(500),
    5000,
  );
  const rows = data?.classifications ?? [];

  const grid = useMemo(() => {
    // grid[stable][class] = count
    const g: Record<string, Record<string, number>> = {};
    for (const s of STABLES) {
      g[s] = Object.fromEntries(CLASSES.map((c) => [c, 0]));
    }
    let max = 0;
    for (const r of rows) {
      const stable = r.stablecoin;
      const cls = (r.classification || "payment").toLowerCase();
      if (!g[stable] || !(cls in g[stable])) continue;
      g[stable][cls] += 1;
      if (g[stable][cls] > max) max = g[stable][cls];
    }
    return { g, max };
  }, [rows]);

  function intensityClass(count: number, cls: string): string {
    if (count === 0) return "bg-foreground/[0.012]";
    const t = count / Math.max(1, grid.max);
    const isAlert = cls === "suspicious";
    // Build a stepped-opacity color value. Tailwind v4 lets us use arbitrary values
    // but we need static class fragments for safelist; using inline style instead.
    return isAlert ? "bg-alert/30" : "bg-signal/30";
  }

  function cellStyle(count: number): React.CSSProperties {
    if (count === 0) return {};
    const t = Math.min(1, 0.18 + (count / Math.max(1, grid.max)) * 0.82);
    return { opacity: t };
  }

  return (
    <section className="w-full px-6 py-12 sm:px-10 lg:px-16 border-b border-line">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-end justify-between border-b border-line pb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="size-1.5 bg-signal animate-pulse" />
              <span className="text-[10px] uppercase tracking-[0.22em] text-muted font-mono">
                Risk heatmap
              </span>
            </div>
            <h2 className="text-2xl tracking-tight">
              Last 500 classifications · stablecoin × class
            </h2>
          </div>
          <span className="font-mono text-[10px] text-faint uppercase tracking-[0.2em]">
            cell intensity = frequency
          </span>
        </header>

        <div className="border border-line">
          {/* Header row */}
          <div
            className="grid border-b border-line bg-foreground/[0.012]"
            style={{
              gridTemplateColumns: `120px repeat(${CLASSES.length}, minmax(0, 1fr))`,
            }}
          >
            <div className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
              Stablecoin
            </div>
            {CLASSES.map((c) => (
              <div
                key={c}
                className={cn(
                  "px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em]",
                  c === "suspicious" ? "text-alert" : "text-muted",
                )}
              >
                {CLASS_LABEL[c]}
              </div>
            ))}
          </div>

          {/* Body rows */}
          {STABLES.map((s, idx) => (
            <div
              key={s}
              className="grid border-b border-line last:border-b-0"
              style={{
                gridTemplateColumns: `120px repeat(${CLASSES.length}, minmax(0, 1fr))`,
              }}
            >
              <div className="px-4 py-4 font-mono text-sm border-r border-line">
                {s}
              </div>
              {CLASSES.map((c) => {
                const count = grid.g[s][c];
                return (
                  <div
                    key={c}
                    className={cn(
                      "relative px-4 py-4 border-r border-line last:border-r-0",
                      "flex items-baseline justify-between gap-2",
                    )}
                  >
                    <div
                      className={cn(
                        "absolute inset-0 pointer-events-none",
                        intensityClass(count, c),
                      )}
                      style={cellStyle(count)}
                    />
                    <span
                      className={cn(
                        "relative font-mono text-base tabular-nums",
                        count === 0 && "text-faint",
                        c === "suspicious" && count > 0 && "text-alert",
                      )}
                    >
                      {fmtCount(count)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
