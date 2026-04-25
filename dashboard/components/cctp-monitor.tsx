"use client";

import { useMemo } from "react";

import { api, type CctpMessage, type CctpVolume } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtUsd, relTime, shortAddr } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";

const CHAIN_GLYPH: Record<string, string> = {
  ethereum: "ETH",
  avalanche: "AVAX",
  optimism: "OP",
  arbitrum: "ARB",
  noble: "NOBL",
  solana: "SOL",
  base: "BASE",
  polygon: "POL",
  unichain: "UNI",
  linea: "LINEA",
};

function ChainGlyph({ name }: { name: string }) {
  const label = CHAIN_GLYPH[name.toLowerCase()] || name.slice(0, 4).toUpperCase();
  return (
    <span className="inline-flex items-center justify-center min-w-[42px] h-6 px-2 border border-line bg-foreground/[0.02] font-mono text-[10px] tracking-[0.16em] text-foreground/80">
      {label}
    </span>
  );
}

export function CctpMonitor() {
  const { data: latest } = usePoll<{ messages: CctpMessage[] }>(
    () => api.cctpLatest(40),
    5000,
  );
  const { data: byDest } = usePoll<{ by_destination: CctpVolume[] }>(
    () => api.cctpByDestination(),
    8000,
  );

  const messages = latest?.messages ?? [];
  const volumes = byDest?.by_destination ?? [];

  const totalVolume = useMemo(
    () => volumes.reduce((acc, v) => acc + (v.volume_usd || 0), 0),
    [volumes],
  );

  return (
    <section className="w-full px-6 py-12 sm:px-10 lg:px-16 border-b border-line">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-end justify-between border-b border-line pb-4 gap-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="size-1.5 bg-signal animate-pulse" />
              <span className="text-[10px] uppercase tracking-[0.22em] text-muted font-mono">
                CCTP monitor
              </span>
            </div>
            <h2 className="text-2xl tracking-tight">
              Cross-chain USDC, decoded from <code className="font-mono text-base">DepositForBurn</code>
            </h2>
          </div>
          <div className="hidden md:flex items-baseline gap-3 font-mono text-[10px] text-faint uppercase tracking-[0.2em]">
            <span>total volume tracked</span>
            <span className="text-foreground text-base normal-case tracking-normal">
              {fmtUsd(totalVolume)}
            </span>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-px bg-line">
          {/* Per-destination volume bars */}
          <div className="bg-background p-5 border border-line">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-4">
              By destination
            </div>
            <div className="flex flex-col gap-3">
              {volumes.length === 0 && (
                <div className="font-mono text-[11px] text-faint">
                  no cctp activity yet
                </div>
              )}
              {volumes.map((v) => {
                const pct =
                  totalVolume > 0
                    ? Math.max(2, Math.round((100 * (v.volume_usd || 0)) / totalVolume))
                    : 0;
                return (
                  <div key={v.destination_chain} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <ChainGlyph name={v.destination_chain} />
                      <span className="font-mono text-xs tabular-nums">
                        {fmtUsd(v.volume_usd || 0)}
                      </span>
                    </div>
                    <div className="relative h-[3px] bg-foreground/[0.06]">
                      <div
                        className="absolute inset-y-0 left-0 bg-signal"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="font-mono text-[10px] text-faint">
                      {v.count} message{v.count === 1 ? "" : "s"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent messages */}
          <div className="bg-background border border-line">
            <div className="grid grid-cols-[42px_42px_minmax(0,1fr)_120px_120px] gap-3 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted border-b border-line">
              <span>FROM</span>
              <span>TO</span>
              <span>DEPOSITOR</span>
              <span className="text-right">AMOUNT</span>
              <span className="text-right">TIME</span>
            </div>

            {messages.length === 0 ? (
              <div className="px-5 py-12 font-mono text-[11px] text-faint text-center">
                Watching DepositForBurn on Circle TokenMessenger v1…
              </div>
            ) : (
              messages.map((m) => (
                <a
                  key={`${m.source_domain}-${m.nonce}`}
                  href={`https://etherscan.io/tx/${m.tx_hash}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={cn(
                    "grid grid-cols-[42px_42px_minmax(0,1fr)_120px_120px] gap-3 px-5 py-3 items-center",
                    "border-b border-line last:border-b-0",
                    "hover:bg-foreground/[0.025] transition-colors",
                  )}
                >
                  <ChainGlyph name={m.source_chain} />
                  <ChainGlyph name={m.destination_chain} />
                  <span className="font-mono text-xs text-foreground/80 truncate">
                    {shortAddr(m.depositor)}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-right text-signal">
                    {fmtUsd(m.amount_usd)}
                  </span>
                  <span className="font-mono text-[10px] text-faint text-right">
                    {relTime(m.ts)}
                  </span>
                </a>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
