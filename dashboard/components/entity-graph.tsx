"use client";

import * as d3 from "d3";
import { useEffect, useMemo, useRef, useState } from "react";

import { api, type Flow } from "@/lib/api";
import {
  CATEGORY_COLOR,
  loadEntities,
  lookupEntity,
  type EntityEntry,
} from "@/lib/entities";
import { fmtUsd, shortAddr } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";

type GraphNode = d3.SimulationNodeDatum & {
  id: string;
  name: string;
  category: string;
  volume: number;
  count: number;
  recent: boolean;
};

type GraphLink = d3.SimulationLinkDatum<GraphNode> & {
  source: string | GraphNode;
  target: string | GraphNode;
  volume: number;
  count: number;
  recent: boolean;
};

const WIDTH = 1280;
const HEIGHT = 600;
const NODE_LIMIT = 60;
const RECENT_WINDOW_S = 60;

export function EntityGraph() {
  const { data, error } = usePoll<{ flows: Flow[] }>(
    () => api.flowsLatest(300),
    4000,
  );
  const flows = data?.flows ?? [];
  const [labels, setLabels] = useState<Record<string, EntityEntry> | null>(
    null,
  );

  useEffect(() => {
    loadEntities().then(setLabels);
  }, []);

  const { nodes, links } = useMemo(() => {
    if (!labels || flows.length === 0) {
      return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
    }
    const now = Math.floor(Date.now() / 1000);
    const nodeMap = new Map<string, GraphNode>();
    const linkMap = new Map<string, GraphLink>();

    for (const f of flows) {
      const usd = f.amount_usd || 0;
      if (usd <= 0) continue; // skip zero-value transfers from the graph
      const from = (f.from_addr || "").toLowerCase();
      const to = (f.to_addr || "").toLowerCase();
      if (!from || !to || from === to) continue;
      const isRecent = now - f.ts < RECENT_WINDOW_S;

      for (const a of [from, to]) {
        if (!nodeMap.has(a)) {
          const ent = lookupEntity(labels, a);
          nodeMap.set(a, {
            id: a,
            name: ent.name,
            category: ent.category,
            volume: 0,
            count: 0,
            recent: false,
          });
        }
        const n = nodeMap.get(a)!;
        n.volume += usd;
        n.count += 1;
        n.recent = n.recent || isRecent;
      }

      const k = `${from}->${to}`;
      if (!linkMap.has(k)) {
        linkMap.set(k, {
          source: from,
          target: to,
          volume: 0,
          count: 0,
          recent: false,
        });
      }
      const l = linkMap.get(k)!;
      l.volume += usd;
      l.count += 1;
      l.recent = l.recent || isRecent;
    }

    // Take top NODE_LIMIT by volume
    const allNodes = [...nodeMap.values()].sort((a, b) => b.volume - a.volume);
    const top = allNodes.slice(0, NODE_LIMIT);
    const keep = new Set(top.map((n) => n.id));
    const trimmedLinks = [...linkMap.values()].filter((l) => {
      const s = typeof l.source === "string" ? l.source : l.source.id;
      const t = typeof l.target === "string" ? l.target : l.target.id;
      return keep.has(s) && keep.has(t);
    });

    return { nodes: top, links: trimmedLinks };
  }, [flows, labels]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tick, setTick] = useState(0);
  const [hover, setHover] = useState<{
    node: GraphNode;
    x: number;
    y: number;
  } | null>(null);
  const simRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);

  // Persist node positions across renders so the layout doesn't reset every poll.
  const positionMemo = useRef<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    if (nodes.length === 0) {
      simRef.current?.stop();
      return;
    }

    // Restore previous positions for already-known nodes; randomise new ones.
    for (const n of nodes) {
      const saved = positionMemo.current.get(n.id);
      if (saved) {
        n.x = saved.x;
        n.y = saved.y;
      } else {
        n.x = WIDTH / 2 + (Math.random() - 0.5) * 80;
        n.y = HEIGHT / 2 + (Math.random() - 0.5) * 80;
      }
    }

    const sim = d3
      .forceSimulation<GraphNode, GraphLink>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance((d) => 80 + 40 / Math.max(1, Math.log10(d.volume + 10)))
          .strength(0.05),
      )
      .force("charge", d3.forceManyBody().strength(-180))
      .force("center", d3.forceCenter(WIDTH / 2, HEIGHT / 2).strength(0.04))
      .force(
        "collide",
        d3.forceCollide<GraphNode>().radius((d) => nodeRadius(d) + 4),
      )
      .alpha(0.7)
      .alphaDecay(0.03)
      .on("tick", () => {
        setTick((t) => t + 1);
        for (const n of nodes) {
          if (n.x !== undefined && n.y !== undefined) {
            positionMemo.current.set(n.id, { x: n.x, y: n.y });
          }
        }
      });

    simRef.current = sim;
    return () => {
      sim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, links.length]);

  return (
    <section className="w-full px-6 py-12 sm:px-10 lg:px-16 border-b border-line">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-end justify-between border-b border-line pb-4 gap-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="size-1.5 bg-signal animate-pulse" />
              <span className="text-[10px] uppercase tracking-[0.22em] text-muted font-mono">
                Entity graph
              </span>
            </div>
            <h2 className="text-2xl tracking-tight">
              Top {NODE_LIMIT} counterparties by USD volume
            </h2>
          </div>
          <div className="hidden md:flex flex-col items-end gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
            <div className="flex items-center gap-2">
              <span className="size-1.5 bg-signal" /> known cex / dex / treasury
            </div>
            <div className="flex items-center gap-2">
              <span className="size-1.5 bg-alert" /> bridge / mev / mint-burn
            </div>
            <div className="flex items-center gap-2">
              <span className="size-1.5 bg-foreground/40" /> unknown
            </div>
          </div>
        </header>

        <div className="relative w-full bg-foreground/[0.012] border border-line overflow-hidden">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            className="block w-full h-auto"
          >
            <defs>
              <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <radialGradient id="recent-pulse" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#00d4aa" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#00d4aa" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* Edges */}
            <g>
              {links.map((l, i) => {
                const s = (typeof l.source === "string"
                  ? null
                  : l.source) as GraphNode | null;
                const t = (typeof l.target === "string"
                  ? null
                  : l.target) as GraphNode | null;
                if (!s || !t || s.x === undefined || t.x === undefined) return null;
                return (
                  <line
                    key={`l-${i}`}
                    x1={s.x}
                    y1={s.y}
                    x2={t.x}
                    y2={t.y}
                    stroke={
                      l.recent ? "rgba(0, 212, 170, 0.55)" : "rgba(237, 237, 237, 0.07)"
                    }
                    strokeWidth={Math.max(0.5, Math.log10(l.volume + 10) - 1)}
                    className={l.recent ? "dash-flow" : undefined}
                  />
                );
              })}
            </g>

            {/* Nodes */}
            <g>
              {nodes.map((n) => {
                if (n.x === undefined || n.y === undefined) return null;
                const r = nodeRadius(n);
                const color = CATEGORY_COLOR[n.category as keyof typeof CATEGORY_COLOR] ||
                  CATEGORY_COLOR.unknown;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x}, ${n.y})`}
                    onMouseEnter={(e) => {
                      const rect = svgRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      const scale = rect.width / WIDTH;
                      setHover({
                        node: n,
                        x: (n.x ?? 0) * scale,
                        y: (n.y ?? 0) * scale,
                      });
                    }}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: "pointer" }}
                  >
                    {n.recent && (
                      <circle
                        r={r * 2.2}
                        fill="url(#recent-pulse)"
                        className="animate-pulse"
                      />
                    )}
                    <circle
                      r={r}
                      fill={color}
                      fillOpacity={n.category === "unknown" ? 0.18 : 0.7}
                      stroke={color}
                      strokeOpacity={0.9}
                      strokeWidth={1}
                      filter="url(#node-glow)"
                    />
                    {r > 10 && (
                      <text
                        textAnchor="middle"
                        y={r + 12}
                        fontSize={9}
                        fontFamily="var(--font-mono, monospace)"
                        fill="rgba(237, 237, 237, 0.7)"
                        style={{ pointerEvents: "none" }}
                      >
                        {n.name.length > 18 ? n.name.slice(0, 16) + "…" : n.name}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>

            {/* React on tick — invisible counter so React re-renders every sim tick */}
            <g style={{ display: "none" }}>{tick}</g>
          </svg>

          {/* Tooltip */}
          {hover && (
            <div
              className="pointer-events-none absolute border border-line-strong bg-background/95 backdrop-blur px-4 py-3 font-mono text-[11px] leading-relaxed"
              style={{
                left: hover.x,
                top: hover.y,
                transform: "translate(-50%, calc(-100% - 16px))",
                minWidth: 220,
              }}
            >
              <div className="text-foreground">{hover.node.name}</div>
              <div className="text-faint mt-1">{shortAddr(hover.node.id, 8, 6)}</div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span className="text-muted">category</span>
                <span className="text-foreground/80">{hover.node.category}</span>
                <span className="text-muted">volume</span>
                <span className="text-signal">{fmtUsd(hover.node.volume)}</span>
                <span className="text-muted">flows</span>
                <span>{hover.node.count}</span>
              </div>
            </div>
          )}

          {/* Loading / empty overlay */}
          {!error && nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-muted">
              Building graph from live flows…
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function nodeRadius(n: GraphNode): number {
  // Log scale: $1 → 4, $1M → ~16, $100M → ~22
  return Math.max(4, Math.min(28, 4 + Math.log10(n.volume + 10) * 3));
}
