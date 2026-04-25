"use client";

import { api, type AgentStatus, type KhExecution, type Swap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtUsd, relTime, shortAddr } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";

const EXPLORER = "https://chainscan-galileo.0g.ai";

function Block({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-faint">
        {label}
      </span>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function AgentPanel() {
  const { data: status } = usePoll<AgentStatus>(api.status, 4000);
  const { data: swapsData } = usePoll<{ swaps: Swap[] }>(
    () => api.swapsLatest(1),
    8000,
  );
  const { data: khData } = usePoll<{ executions: KhExecution[] }>(
    () => api.khLatest(1),
    8000,
  );

  const inft = status?.inft;
  const storage = status?.storage;
  const swap = status?.swap;
  const lastSwap = swapsData?.swaps?.[0];
  const lastKh = khData?.executions?.[0];
  const khTotal = status?.kh_executions ?? 0;

  return (
    <section className="w-full px-6 py-12 sm:px-10 lg:px-16 border-b border-line">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-end justify-between border-b border-line pb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="size-1.5 bg-signal animate-pulse" />
              <span className="text-[10px] uppercase tracking-[0.22em] text-muted font-mono">
                Agent panel
              </span>
            </div>
            <h2 className="text-2xl tracking-tight">
              Identity, attestation, execution
            </h2>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-line">
          {/* iNFT card */}
          <div className="bg-background p-6 flex flex-col gap-5 border border-line">
            <Block label="ERC-7857 iNFT">
              <div className="font-mono text-foreground">
                {inft?.ready ? (
                  <>
                    <span className="text-signal">●</span> Token #{inft.token_id}
                  </>
                ) : (
                  <span className="text-muted">not minted</span>
                )}
              </div>
            </Block>
            <Block label="Owner">
              <span className="font-mono text-xs">
                {shortAddr(inft?.owner, 8, 6)}
              </span>
            </Block>
            <Block label="Model · Version">
              <span className="font-mono text-xs">
                {inft?.model_descriptor || "—"}
                <span className="text-faint"> · </span>
                {inft?.version_tag || "—"}
              </span>
            </Block>
            <Block label="Identity Merkle root">
              <a
                href={
                  inft?.contract_address
                    ? `${EXPLORER}/address/${inft.contract_address}`
                    : "#"
                }
                target="_blank"
                rel="noreferrer noopener"
                className="font-mono text-xs text-signal hover:underline break-all"
              >
                {inft?.storage_root_hash
                  ? `${inft.storage_root_hash.slice(0, 18)}…${inft.storage_root_hash.slice(-6)}`
                  : "—"}
              </a>
            </Block>
            <Block label="Minted">
              <span className="font-mono text-xs text-muted">
                {inft?.minted_at
                  ? new Date(inft.minted_at * 1000).toUTCString()
                  : "—"}
              </span>
            </Block>
          </div>

          {/* 0G Storage */}
          <div className="bg-background p-6 flex flex-col gap-5 border border-line">
            <Block label="0G Storage · latest snapshot">
              <span className="font-mono text-foreground">
                {storage?.latest_root_hash ? (
                  <>
                    <span className="text-signal">●</span> {storage.flow_count}{" "}
                    flows
                  </>
                ) : (
                  <span className="text-muted">no snapshot yet</span>
                )}
              </span>
            </Block>
            <Block label="Merkle root">
              <span className="font-mono text-xs break-all">
                {storage?.latest_root_hash
                  ? `${storage.latest_root_hash.slice(0, 18)}…${storage.latest_root_hash.slice(-6)}`
                  : "—"}
              </span>
            </Block>
            <Block label="Uploaded">
              <span className="font-mono text-xs text-muted">
                {storage?.uploaded_at ? relTime(storage.uploaded_at) : "—"}
              </span>
            </Block>
            <Block label="Cadence">
              <span className="font-mono text-xs text-muted">
                30 min · 30,000 flows / snapshot
              </span>
            </Block>
            <div className="mt-2 pt-4 border-t border-line">
              <Block label="0G Compute">
                <span className="font-mono text-xs text-muted">
                  qwen-2.5-7b-instruct · TDX TEE
                </span>
              </Block>
            </div>
          </div>

          {/* KeeperHub */}
          <div className="bg-background p-6 flex flex-col gap-5 border border-line">
            <Block label="KeeperHub · protective swap">
              <span className="font-mono text-foreground">
                {swap?.ready ? (
                  <>
                    <span className="text-signal">●</span> armed ·{" "}
                    {swap.network}
                  </>
                ) : swap?.configured ? (
                  <>
                    <span className="text-alert">●</span> awaiting{" "}
                    {swap.network} funding
                  </>
                ) : (
                  <span className="text-muted">not configured</span>
                )}
              </span>
            </Block>
            {swap?.configured && !swap?.ready && (
              <Block label="Funding needed">
                <span className="font-mono text-[11px] text-muted leading-relaxed">
                  Send Sepolia ETH (
                  <a
                    href="https://sepoliafaucet.com"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-signal hover:underline"
                  >
                    faucet
                  </a>
                  ) and Sepolia USDC (
                  <a
                    href="https://faucet.circle.com"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-signal hover:underline"
                  >
                    Circle
                  </a>
                  ) to the KeeperHub Turnkey wallet, then restart the agent —
                  the USDC approval fires automatically. WETH is received from
                  the swap so no pre-funding needed.
                </span>
              </Block>
            )}
            <Block label="Trigger">
              <span className="font-mono text-xs text-muted">
                Mainnet USDC/USDT spread &gt; {swap?.threshold_bps ?? 50} bps →{" "}
                ${swap?.amount_usd ?? 100} USDC → WETH
              </span>
            </Block>
            {lastSwap ? (
              <>
                <Block label="Last execution">
                  <span className="font-mono text-xs">
                    {lastSwap.token_in_symbol} → {lastSwap.token_out_symbol}{" "}
                    {fmtUsd(lastSwap.amount_in_usd)}
                  </span>
                </Block>
                <Block label="KeeperHub status">
                  <span className="font-mono text-xs text-signal">
                    {lastSwap.keeperhub_status || "—"}
                  </span>
                </Block>
                <Block label="Execution ID">
                  <span className="font-mono text-xs break-all text-foreground/70">
                    {lastSwap.keeperhub_execution_id || "—"}
                  </span>
                </Block>
              </>
            ) : (
              <Block label="Last execution">
                <span className="font-mono text-xs text-muted">
                  no swaps yet — natural depeg trigger or{" "}
                  <code className="text-foreground/70">
                    POST /admin/trigger-swap
                  </code>
                </span>
              </Block>
            )}
            <div className="mt-2 pt-4 border-t border-line">
              <Block label="KeeperHub MCP · workflow runs">
                <span className="font-mono text-xs">
                  <span className="text-signal">●</span>{" "}
                  {fmtUsd(khTotal).replace("$", "")} executions on critical
                  classifications
                </span>
              </Block>
              {lastKh ? (
                <div className="mt-2 font-mono text-[10px] text-faint break-all">
                  last exec:{" "}
                  <span className="text-foreground/80">
                    {(lastKh.execution_id || "—").slice(0, 18)}…
                  </span>{" "}
                  · {lastKh.status || "?"} · {relTime(lastKh.ts)}
                </div>
              ) : (
                <div className="mt-2 font-mono text-[10px] text-faint">
                  no risk-3 classifications yet
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
