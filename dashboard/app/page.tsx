import { FlowFeed } from "@/components/flow-feed";
import { Hero } from "@/components/hero";

export default function Home() {
  return (
    <main className="flex flex-col flex-1 w-full">
      <Hero />
      <FlowFeed />
      <footer className="px-6 py-10 sm:px-10 lg:px-16 border-t border-line">
        <div className="max-w-7xl mx-auto flex flex-wrap gap-x-8 gap-y-2 items-baseline">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            Built with
          </span>
          <span className="font-mono text-xs text-foreground/70">
            0G Chain · 0G Storage · 0G Compute · ERC-7857 iNFT
          </span>
          <span className="font-mono text-xs text-foreground/70">
            KeeperHub · Bitquery · Alchemy · Coingecko
          </span>
        </div>
      </footer>
    </main>
  );
}
