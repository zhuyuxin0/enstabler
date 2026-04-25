import { AgentPanel } from "@/components/agent-panel";
import { CctpMonitor } from "@/components/cctp-monitor";
import { EntityGraph } from "@/components/entity-graph";
import { FlowFeed } from "@/components/flow-feed";
import { Hero } from "@/components/hero";
import { RiskHeatmap } from "@/components/risk-heatmap";

export default function Home() {
  return (
    <main className="flex flex-col flex-1 w-full">
      <Hero />
      <FlowFeed />
      <EntityGraph />
      <RiskHeatmap />
      <CctpMonitor />
      <AgentPanel />
      <footer className="px-6 py-10 sm:px-10 lg:px-16 border-t border-line">
        <div className="max-w-7xl mx-auto flex flex-wrap gap-x-8 gap-y-3 items-baseline justify-between">
          <div className="flex flex-wrap gap-x-8 gap-y-2 items-baseline">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              Built with
            </span>
            <span className="font-mono text-xs text-foreground/70">
              0G Chain · Storage · Compute · ERC-7857 iNFT
            </span>
            <span className="font-mono text-xs text-foreground/70">
              KeeperHub · Alchemy · Circle CCTP · Coingecko
            </span>
          </div>
          <a
            href="https://github.com/zhuyuxin0/enstabler"
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted hover:text-foreground transition-colors"
          >
            github.com/zhuyuxin0/enstabler
          </a>
        </div>
      </footer>
    </main>
  );
}
