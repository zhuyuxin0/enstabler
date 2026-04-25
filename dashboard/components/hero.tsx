"use client";

import { api, type AgentStatus } from "@/lib/api";
import { fmtCount } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";

import { BlurFade } from "./blur-fade";
import { NumberTicker } from "./number-ticker";
import { StatPill } from "./stat-pill";

export function Hero() {
  const { data: status } = usePoll<AgentStatus>(api.status, 3000);

  const total = status?.flows_ingested ?? 0;
  const counts = status?.classifications ?? {};
  const suspicious = counts.suspicious ?? 0;
  const onChain =
    (status?.classifications &&
      Object.entries(status.classifications)
        .filter(([k]) => k !== "payment")
        .reduce((acc, [, v]) => acc + (v as number), 0)) ??
    0;
  const cctp = status?.cctp_messages ?? 0;

  return (
    <section className="relative w-full px-6 py-20 sm:px-10 lg:px-16 overflow-hidden">
      {/* Faint dot-pattern accent (top-right) */}
      <div
        aria-hidden
        className="absolute top-0 right-0 w-[480px] h-[480px] opacity-[0.06] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--color-foreground) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      />

      <div className="relative max-w-7xl mx-auto">
        <BlurFade delay={0}>
          <div className="flex items-center gap-3 mb-10">
            <span className="inline-block size-2 bg-signal animate-pulse" />
            <span className="text-[11px] uppercase tracking-[0.22em] text-muted font-mono">
              Live · Ethereum mainnet · 0G Galileo
            </span>
          </div>
        </BlurFade>

        <BlurFade delay={0.05}>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl tracking-tight leading-[1.05] max-w-4xl">
            Don&apos;t trust stablecoin flows —
            <br />
            <span className="text-signal">verify them.</span>
          </h1>
        </BlurFade>

        <BlurFade delay={0.15}>
          <p className="mt-6 max-w-2xl text-lg text-muted leading-relaxed">
            Enstabler watches every USDT, USDC, DAI and PYUSD transfer on
            Ethereum, classifies it, and publishes the verdict on-chain via
            0G + KeeperHub. Each score links to a 0G&nbsp;Storage Merkle root
            you can audit.
          </p>
        </BlurFade>

        <BlurFade delay={0.25}>
          <div className="mt-12 flex items-baseline gap-3">
            <NumberTicker
              value={total}
              className="text-7xl sm:text-8xl text-foreground"
            />
            <span className="text-xs font-mono uppercase tracking-[0.2em] text-faint pb-3">
              flows classified
            </span>
          </div>
        </BlurFade>

        <BlurFade delay={0.35}>
          <div className="mt-10 flex flex-wrap gap-3">
            <StatPill
              label="Suspicious"
              value={
                <NumberTicker
                  value={suspicious}
                  className="text-2xl text-alert"
                />
              }
              tone={suspicious > 0 ? "alert" : "default"}
            />
            <StatPill
              label="Non-payment classifications"
              value={
                <NumberTicker value={onChain} className="text-2xl text-signal" />
              }
              tone="signal"
            />
            <StatPill
              label="CCTP cross-chain"
              value={<NumberTicker value={cctp} className="text-2xl" />}
            />
            <StatPill
              label="Watchers online"
              value={
                <NumberTicker
                  value={status?.watchers?.length ?? 0}
                  className="text-2xl"
                />
              }
            />
          </div>
        </BlurFade>
      </div>
    </section>
  );
}
