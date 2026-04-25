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
const HEIGHT = 620;
const NODE_LIMIT = 60;
const RECENT_WINDOW_S = 90;

export function EntityGraph() {
  const { data, error } = usePoll<{ flows: Flow[] }>(
    () => api.flowsLatest(300),
    5000,
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
      if (usd <= 0) continue;
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
  const simRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const positionMemo = useRef<Map<string, { x: number; y: number }>>(new Map());
  // Snapshot of node + link positions used for rendering. Updated on every
  // simulation tick. Storing in state would re-render every tick; instead we
  // use a single tick counter and read positions directly from the live nodes.
  const [, setTick] = useState(0);

  const [hover, setHover] = useState<{
    node: GraphNode;
    x: number;
    y: number;
  } | null>(null);

  // (Re-)build the simulation only when the SET of nodes/links genuinely
  // changes. Subsequent polls just reheat the existing sim gently.
  useEffect(() => {
    if (nodes.length === 0) {
      simRef.current?.stop();
      simRef.current = null;
      return;
    }

    // Restore prior positions for nodes we've seen before; place new nodes
    // near the centre with a small random offset.
    for (const n of nodes) {
      const saved = positionMemo.current.get(n.id);
      if (saved) {
        n.x = saved.x;
        n.y = saved.y;
      } else {
        n.x = WIDTH / 2 + (Math.random() - 0.5) * 60;
        n.y = HEIGHT / 2 + (Math.random() - 0.5) * 60;
      }
    }

    // Tear down any previous sim before creating a new one.
    simRef.current?.stop();

    const sim = d3
      .forceSimulation<GraphNode, GraphLink>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance((d) => 90 + 50 / Math.max(1, Math.log10(d.volume + 10)))
          .strength(0.06),
      )
      .force("charge", d3.forceManyBody().strength(-220))
      .force("center", d3.forceCenter(WIDTH / 2, HEIGHT / 2).strength(0.05))
      .force(
        "collide",
        d3.forceCollide<GraphNode>().radius((d) => nodeRadius(d) + 6),
      )
      // Gentler reheat: alpha decays slowly so the sim settles into a calm
      // steady-state instead of jittering after every poll.
      .alpha(0.4)
      .alphaDecay(0.018)
      .alphaMin(0.001)
      .velocityDecay(0.5)
      .on("tick", () => {
        setTick((t) => (t + 1) % 1_000_000);
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

  // On poll without structural change, just nudge the sim slightly so it
  // adjusts to any updated link weights without throwing nodes around.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.alpha(0.08).restart();
  }, [flows]);

  const links2 = links.map((l) => ({
    ...l,
    sourceNode: typeof l.source === "string" ? null : (l.source as GraphNode),
    targetNode: typeof l.target === "string" ? null : (l.target as GraphNode),
  }));

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
            <p className="mt-1 text-xs text-muted max-w-xl">
              Each node is a wallet observed in the last few minutes of mainnet
              flows; size reflects total USD volume. Glowing edges and pulses
              mean the wallet was active in the last 90 seconds.
            </p>
          </div>
          <div className="hidden md:flex flex-col items-end gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
            <div className="flex items-center gap-2">
              <span className="size-1.5 bg-signal" /> known cex / dex / treasury
            </div>
            <div className="flex items-center gap-2">
              <span className="size-1.5 bg-alert" /> bridge / mev / mint-burn
            </div>
            <div className="flex items-center gap-2">
              <span className="size-1.5 bg-foreground/40" /> unknown EOA
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
              <filter id="node-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <radialGradient id="recent-pulse" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#00d4aa" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#00d4aa" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="edge-recent" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(0,212,170,0)" />
                <stop offset="50%" stopColor="rgba(0,212,170,0.6)" />
                <stop offset="100%" stopColor="rgba(0,212,170,0)" />
              </linearGradient>
            </defs>

            {/* Ambient backdrop dots (faint constellation) */}
            <g opacity="0.18">
              {AMBIENT_DOTS.map((d, i) => (
                <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="rgba(237,237,237,0.5)" />
              ))}
            </g>

            {/* Edges (curved) */}
            <g>
              {links2.map((l, i) => {
                const s = l.sourceNode;
                const t = l.targetNode;
                if (!s || !t || s.x === undefined || t.x === undefined) return null;
                const path = curvePath(s.x!, s.y!, t.x!, t.y!);
                const w = Math.max(0.5, Math.log10(l.volume + 10) - 0.8);
                return (
                  <g key={`${l.source}-${l.target}-${i}`}>
                    <path
                      d={path}
                      fill="none"
                      stroke={
                        l.recent
                          ? "url(#edge-recent)"
                          : "rgba(237, 237, 237, 0.06)"
                      }
                      strokeWidth={w}
                      strokeLinecap="round"
                      className={l.recent ? "dash-flow" : undefined}
                      style={l.recent ? { strokeDasharray: "4 8" } : undefined}
                    />
                    {l.recent && (
                      <circle r={2.5} fill="#00d4aa" opacity={0.9}>
                        <animateMotion
                          dur={`${2.4 + (i % 3) * 0.6}s`}
                          repeatCount="indefinite"
                          path={path}
                        />
                      </circle>
                    )}
                  </g>
                );
              })}
            </g>

            {/* Nodes — wrapped in a <g> with CSS transition for smooth motion */}
            <g>
              {nodes.map((n) => {
                if (n.x === undefined || n.y === undefined) return null;
                const r = nodeRadius(n);
                const color =
                  CATEGORY_COLOR[n.category as keyof typeof CATEGORY_COLOR] ||
                  CATEGORY_COLOR.unknown;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x}, ${n.y})`}
                    style={{
                      transition:
                        "transform 0.7s cubic-bezier(0.22, 1, 0.36, 1)",
                      cursor: "pointer",
                    }}
                    onMouseEnter={() => {
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
                  >
                    {n.recent && (
                      <circle
                        r={r * 2.4}
                        fill="url(#recent-pulse)"
                        className="animate-pulse"
                      />
                    )}
                    <circle
                      r={r}
                      fill={color}
                      fillOpacity={n.category === "unknown" ? 0.16 : 0.7}
                      stroke={color}
                      strokeOpacity={0.95}
                      strokeWidth={1}
                      filter="url(#node-glow)"
                    />
                    {r > 11 && (
                      <text
                        textAnchor="middle"
                        y={r + 13}
                        fontSize={9.5}
                        fontFamily="var(--font-mono, monospace)"
                        fill="rgba(237, 237, 237, 0.78)"
                        style={{ pointerEvents: "none" }}
                      >
                        {n.name.length > 18 ? n.name.slice(0, 16) + "…" : n.name}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
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
              <div className="text-faint mt-1">
                {shortAddr(hover.node.id, 8, 6)}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span className="text-muted">category</span>
                <span className="text-foreground/80">{hover.node.category}</span>
                <span className="text-muted">volume</span>
                <span className="text-signal">
                  {fmtUsd(hover.node.volume)}
                </span>
                <span className="text-muted">flows</span>
                <span>{hover.node.count}</span>
              </div>
            </div>
          )}

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
  return Math.max(4, Math.min(28, 4 + Math.log10(n.volume + 10) * 3));
}

// Quadratic bezier between two points with a perpendicular offset for curve.
function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  // Perpendicular offset for organic curvature; sign deterministic per pair.
  const offset = Math.min(70, len * 0.22) * (((x1 + y1) % 2) - 0.5) * 2;
  const nx = -dy / len;
  const ny = dx / len;
  const cx = mx + nx * offset;
  const cy = my + ny * offset;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

// Static deterministic "stars" for ambient backdrop.
const AMBIENT_DOTS = (() => {
  const out: { x: number; y: number; r: number }[] = [];
  let seed = 1337;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 80; i++) {
    out.push({
      x: rand() * WIDTH,
      y: rand() * HEIGHT,
      r: rand() < 0.15 ? 1.4 : 0.7,
    });
  }
  return out;
})();
