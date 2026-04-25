// Client-side entity-label resolution. Pulls the labels JSON once at module
// load and exposes a quick lookup. The labels file is shipped as a static
// asset under /data/entity-labels.json (mirrored from the agent's
// data/entity_labels.json — see docs).

export type EntityCategory =
  | "cex"
  | "dex"
  | "bridge"
  | "lending"
  | "stablecoin_issuer"
  | "treasury"
  | "mev"
  | "zero"
  | "other"
  | "unknown";

export type EntityEntry = {
  name: string;
  category: EntityCategory;
};

let cache: Record<string, EntityEntry> | null = null;
let inflight: Promise<Record<string, EntityEntry>> | null = null;

export async function loadEntities(): Promise<Record<string, EntityEntry>> {
  if (cache) return cache;
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await fetch("/data/entity-labels.json", { cache: "force-cache" });
        const json = await res.json();
        const labels = json.labels || {};
        const lower: Record<string, EntityEntry> = {};
        for (const k of Object.keys(labels)) {
          lower[k.toLowerCase()] = labels[k];
        }
        cache = lower;
        return lower;
      } catch {
        cache = {};
        return cache;
      }
    })();
  }
  return inflight;
}

export function lookupEntity(
  labels: Record<string, EntityEntry>,
  addr: string | null | undefined,
): EntityEntry {
  if (!addr) return { name: "unknown", category: "unknown" };
  const a = addr.toLowerCase();
  if (a === "0x0000000000000000000000000000000000000000")
    return { name: "zero address", category: "zero" };
  return labels[a] || { name: addr, category: "unknown" };
}

// Color per category — used by the entity graph nodes/edges
export const CATEGORY_COLOR: Record<EntityCategory, string> = {
  cex: "#00d4aa",
  dex: "#00d4aa",
  bridge: "#ff6b35",
  lending: "#00d4aa",
  stablecoin_issuer: "#00d4aa",
  treasury: "#00d4aa",
  mev: "#ff6b35",
  zero: "#ff6b35",
  other: "rgba(237, 237, 237, 0.6)",
  unknown: "rgba(237, 237, 237, 0.35)",
};
