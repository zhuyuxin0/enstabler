"use client";

import { api, type AgentStatus } from "@/lib/api";
import { fmtCount } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";

import { BlurFade } from "./blur-fade";
import { NumberTicker } from "./number-ticker";

function HeroStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "signal" | "alert";
}) {
  const colorCls =
    tone === "signal"
      ? "text-signal"
      : tone === "alert"
        ? "text-alert"
        : "text-foreground";
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-[0.22em] text-faint font-mono">
        {label}
      </span>
      <NumberTicker
        value={value}
        className={`text-3xl sm:text-4xl tabular-nums leading-none ${colorCls}`}
      />
    </div>
  );
}

export function Hero() {
  const { data: status, error } = usePoll<AgentStatus>(api.status, 3000);

  const total = status?.flows_ingested ?? 0;
  const counts = status?.classifications ?? {};
  const suspicious = counts.suspicious ?? 0;
  const nonPayment =
    Object.entries(counts)
      .filter(([k]) => k !== "payment")
      .reduce((acc, [, v]) => acc + (v as number), 0) ?? 0;
  const cctp = status?.cctp_messages ?? 0;
  const watchersOnline = status?.watchers?.length ?? 0;
  const isLive = !error && (total > 0 || (status?.watchers?.length ?? 0) > 0);

  return (
    <section className="relative w-full px-6 sm:px-10 lg:px-16 pt-16 pb-12 overflow-hidden border-b border-line">
      {/* Faint dot pattern accent (top-right corner) */}
      <div
        aria-hidden
        className="absolute -top-12 -right-12 w-[640px] h-[640px] opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--color-foreground) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
          maskImage:
            "radial-gradient(circle at top right, black 0%, transparent 65%)",
          WebkitMaskImage:
            "radial-gradient(circle at top right, black 0%, transparent 65%)",
        }}
      />

      <div className="relative max-w-7xl mx-auto">
        {/* Top status row */}
        <BlurFade delay={0}>
          <div className="flex items-center justify-between gap-4 mb-12">
            <div className="flex items-center gap-3">
              <span
                className={`size-2 rounded-none ${
                  isLive ? "bg-signal animate-pulse" : "bg-alert"
                }`}
              />
              <span className="text-[11px] uppercase tracking-[0.22em] text-muted font-mono">
                {isLive
                  ? "Reading Ethereum mainnet · Writing 0G Galileo testnet"
                  : "Agent offline · start the backend"}
              </span>
            </div>
            <div className="hidden md:flex items-center gap-6 text-[11px] uppercase tracking-[0.22em] text-faint font-mono">
              <a
                href="https://github.com/zhuyuxin0/enstabler"
                className="hover:text-foreground transition-colors"
                target="_blank"
                rel="noreferrer noopener"
              >
                Source
              </a>
              <a
                href="https://chainscan-galileo.0g.ai/address/0x6A5861f8bc5b884a6B605Bec809d6Eb2478D052C"
                className="hover:text-foreground transition-colors"
                target="_blank"
                rel="noreferrer noopener"
              >
                FlowRiskOracle
              </a>
              <a
                href="https://chainscan-galileo.0g.ai/address/0x7c6CF625bcaA9A8987d21D7CF598a95cAE20D0cC"
                className="hover:text-foreground transition-colors"
                target="_blank"
                rel="noreferrer noopener"
              >
                Agent iNFT
              </a>
            </div>
          </div>
        </BlurFade>

        {/* Headline grid: 8/4 split */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-end">
          <div className="lg:col-span-7">
            <BlurFade delay={0.05}>
              <h1 className="text-5xl sm:text-6xl lg:text-7xl tracking-tight leading-[1.0]">
                Don&apos;t trust
                <br />
                stablecoin flows.
              </h1>
            </BlurFade>

            <BlurFade delay={0.12}>
              <div className="mt-3 flex items-baseline gap-3">
                <span className="font-mono text-2xl sm:text-3xl text-signal/60">
                  →
                </span>
                <span className="font-mono text-2xl sm:text-3xl text-signal tracking-tight">
                  verify them.
                </span>
              </div>
            </BlurFade>

            <BlurFade delay={0.2}>
              <p className="mt-8 max-w-xl text-base sm:text-lg text-muted leading-relaxed">
                Enstabler watches every USDT, USDC, DAI and PYUSD transfer on
                Ethereum, classifies it, and publishes the verdict on-chain via
                0G + KeeperHub. Each score links to a 0G&nbsp;Storage Merkle
                root you can audit.
              </p>
            </BlurFade>
          </div>

          {/* Right column: live numbers panel */}
          <div className="lg:col-span-5">
            <BlurFade delay={0.25}>
              <div className="border border-line bg-foreground/[0.012] backdrop-blur-sm">
                <div className="px-6 py-5 border-b border-line flex items-baseline justify-between gap-4">
                  <span className="text-[10px] uppercase tracking-[0.22em] text-muted font-mono">
                    Flows classified
                  </span>
                  <span className="font-mono text-[10px] text-faint">
                    updated 3s
                  </span>
                </div>
                <div className="px-6 py-6">
                  <NumberTicker
                    value={total}
                    className="text-5xl sm:text-6xl tabular-nums leading-none"
                  />
                  <div className="mt-1 font-mono text-[10px] text-faint uppercase tracking-[0.22em]">
                    since boot
                  </div>
                </div>
                <div className="grid grid-cols-2 border-t border-line">
                  <div className="px-6 py-5 border-r border-line">
                    <HeroStat
                      label="Suspicious"
                      value={suspicious}
                      tone={suspicious > 0 ? "alert" : "default"}
                    />
                  </div>
                  <div className="px-6 py-5">
                    <HeroStat
                      label="Non-payment"
                      value={nonPayment}
                      tone={nonPayment > 0 ? "signal" : "default"}
                    />
                  </div>
                  <div className="px-6 py-5 border-r border-t border-line">
                    <HeroStat label="CCTP cross-chain" value={cctp} />
                  </div>
                  <div className="px-6 py-5 border-t border-line">
                    <HeroStat
                      label="Watchers online"
                      value={watchersOnline}
                      tone={watchersOnline >= 5 ? "signal" : "default"}
                    />
                  </div>
                </div>
              </div>
            </BlurFade>

            {error && (
              <BlurFade delay={0.35}>
                <div className="mt-3 border border-alert/40 bg-alert-soft/40 px-5 py-3 font-mono text-[11px] text-alert/90 leading-relaxed">
                  Agent backend not reachable at{" "}
                  <code className="text-alert">
                    {process.env.NEXT_PUBLIC_API_URL ??
                      "http://localhost:8000"}
                  </code>
                  . Start it with{" "}
                  <code className="text-alert">
                    uvicorn agent.server:app --port 8000
                  </code>
                  .
                </div>
              </BlurFade>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
