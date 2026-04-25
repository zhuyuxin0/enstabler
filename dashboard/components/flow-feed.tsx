"use client";

import { AnimatePresence, motion } from "motion/react";

import { api, type Flow } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtUsd, relTime, shortAddr } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";

const CLASSIFICATION_TONE: Record<
  string,
  { label: string; bar: string; chip: string }
> = {
  payment:    { label: "PAYMENT",    bar: "bg-foreground/40", chip: "text-muted" },
  cex_flow:   { label: "CEX FLOW",   bar: "bg-signal/70",     chip: "text-signal" },
  arbitrage:  { label: "ARBITRAGE",  bar: "bg-signal/70",     chip: "text-signal" },
  bot:        { label: "BOT",        bar: "bg-foreground/30", chip: "text-muted" },
  mint_burn:  { label: "MINT/BURN",  bar: "bg-signal/70",     chip: "text-signal" },
  suspicious: { label: "SUSPICIOUS", bar: "bg-alert",         chip: "text-alert" },
};

function FlowRow({ flow }: { flow: Flow }) {
  const cls = (flow.classification ?? "payment").toLowerCase();
  const tone = CLASSIFICATION_TONE[cls] ?? CLASSIFICATION_TONE.payment;
  const risk = flow.risk_level ?? 0;
  const isSuspicious = cls === "suspicious";
  const isPublished = !!flow.published;

  const explorerHref = `https://etherscan.io/tx/${flow.tx_hash}`;

  return (
    <motion.a
      href={explorerHref}
      target="_blank"
      rel="noreferrer noopener"
      layout
      initial={{ opacity: 0, y: -8, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -4, filter: "blur(2px)" }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn(
        "group relative grid grid-cols-[80px_minmax(0,1fr)_120px_120px] items-center gap-4",
        "px-5 py-3 border-l border-y border-line bg-foreground/[0.012]",
        "hover:bg-foreground/[0.04] hover:border-line-strong transition-colors duration-150",
        isSuspicious && "border-alert/30 alert-pulse",
      )}
    >
      {/* Stablecoin */}
      <div className="font-mono text-xs uppercase tracking-wider text-muted">
        {flow.stablecoin}
      </div>

      {/* Sender → Receiver */}
      <div className="flex items-center gap-2 min-w-0 font-mono text-xs">
        <span className="text-foreground/80 truncate">
          {shortAddr(flow.from_addr)}
        </span>
        <span className="text-faint shrink-0">→</span>
        <span className="text-foreground/80 truncate">
          {shortAddr(flow.to_addr)}
        </span>
        {isPublished && (
          <span
            className="ml-2 shrink-0 text-[9px] uppercase tracking-[0.2em] text-signal/80 font-sans"
            title="Published on-chain to FlowRiskOracle"
          >
            ⛓ on-chain
          </span>
        )}
      </div>

      {/* Amount + risk bar */}
      <div className="flex flex-col items-end gap-1.5">
        <span className="font-mono text-sm tabular-nums">
          {fmtUsd(flow.amount_usd)}
        </span>
        <div className="flex gap-0.5 h-[3px] w-16">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn(
                "flex-1",
                i < risk ? tone.bar : "bg-foreground/[0.08]",
              )}
            />
          ))}
        </div>
      </div>

      {/* Classification chip */}
      <div className="flex flex-col items-end gap-1">
        <span
          className={cn(
            "font-mono text-[10px] uppercase tracking-[0.18em]",
            tone.chip,
          )}
        >
          {tone.label}
        </span>
        <span className="font-mono text-[10px] text-faint">
          {relTime(flow.ts)}
        </span>
      </div>
    </motion.a>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[80px_minmax(0,1fr)_120px_120px] items-center gap-4 px-5 py-3 border-l border-y border-line bg-foreground/[0.008]"
          style={{ opacity: Math.max(0.18, 1 - i * 0.1) }}
        >
          <div className="h-3 w-12 bg-foreground/5" />
          <div className="flex items-center gap-2">
            <div className="h-3 w-32 bg-foreground/5" />
            <span className="text-faint">→</span>
            <div className="h-3 w-32 bg-foreground/5" />
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="h-3 w-16 bg-foreground/5" />
            <div className="h-[3px] w-16 bg-foreground/5" />
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="h-3 w-20 bg-foreground/5" />
            <div className="h-2 w-12 bg-foreground/5" />
          </div>
        </div>
      ))}
    </>
  );
}

export function FlowFeed() {
  const { data, error } = usePoll<{ flows: Flow[] }>(
    () => api.flowsLatest(40),
    2500,
  );

  const flows = data?.flows ?? [];

  return (
    <section className="w-full px-6 py-12 sm:px-10 lg:px-16">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-end justify-between border-b border-line pb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="size-1.5 bg-signal animate-pulse" />
              <span className="text-[10px] uppercase tracking-[0.22em] text-muted font-mono">
                Live feed
              </span>
            </div>
            <h2 className="text-2xl tracking-tight">Stablecoin transfers, classified in real time</h2>
          </div>
          <div className="font-mono text-[10px] text-faint uppercase tracking-[0.2em]">
            click row → etherscan
          </div>
        </header>

        <div className="fade-mask max-h-[640px] overflow-hidden no-scrollbar">
          <div className="flex flex-col gap-px">
            {!error && flows.length === 0 ? (
              <SkeletonRows />
            ) : (
              <AnimatePresence initial={false}>
                {flows.map((f) => (
                  <FlowRow key={`${f.chain}-${f.tx_hash}-${f.log_index}`} flow={f} />
                ))}
              </AnimatePresence>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
