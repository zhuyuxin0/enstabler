// Typed fetchers for the Enstabler FastAPI backend.
// Polling-based; no global state library needed.

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type AgentStatus = {
  agent: string;
  milestone: string;
  flows_ingested: number;
  classifications: Record<string, number>;
  swaps: number;
  cctp_messages: number;
  kh_executions: number;
  watchers: string[];
  swap: {
    configured: boolean;
    ready: boolean;
    network: string;
    threshold_bps: number;
    amount_usd: number;
  };
  storage: {
    configured: boolean;
    disabled: boolean;
    latest_root_hash: string | null;
    latest_tx_hash: string | null;
    uploaded_at: number | null;
    flow_count: number;
  };
  inft: {
    configured: boolean;
    ready: boolean;
    contract_address: string | null;
    token_id: number | null;
    owner: string | null;
    storage_root_hash: string | null;
    model_descriptor: string | null;
    version_tag: string | null;
    minted_at: number | null;
    last_updated_at: number | null;
  };
};

export type Flow = {
  id: number;
  source: string;
  chain: string;
  tx_hash: string;
  log_index: number;
  block_number: number;
  ts: number;
  stablecoin: string;
  from_addr: string;
  to_addr: string;
  amount_raw: string;
  amount_usd: number | null;
  classification: string | null;
  risk_level: number | null;
  published: number | null;
  onchain_tx_hash: string | null;
  explanation: string | null;
};

export type CctpMessage = {
  id: number;
  ts: number;
  source_chain: string;
  source_domain: number;
  destination_chain: string;
  destination_domain: number;
  nonce: number;
  burn_token: string;
  amount_raw: string;
  amount_usd: number | null;
  depositor: string;
  mint_recipient: string;
  tx_hash: string;
  block_number: number;
  log_index: number;
};

export type CctpVolume = {
  destination_chain: string;
  count: number;
  volume_usd: number | null;
};

export type KhExecution = {
  id: number;
  ts: number;
  classification_id: number | null;
  workflow_id: string;
  execution_id: string | null;
  status: string | null;
  error: string | null;
  inputs_json: string | null;
};

export type Swap = {
  id: number;
  ts: number;
  trigger_reason: string;
  spread: number;
  token_in_symbol: string;
  token_out_symbol: string;
  amount_in_usd: number;
  network: string;
  keeperhub_execution_id: string | null;
  keeperhub_status: string | null;
  tx_hash: string | null;
  error: string | null;
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const api = {
  status: () => getJson<AgentStatus>("/status"),
  flowsLatest: (limit = 50) =>
    getJson<{ flows: Flow[] }>(`/flows/latest?limit=${limit}`),
  classificationsLatest: (limit = 50) =>
    getJson<{ classifications: Flow[] }>(`/classifications/latest?limit=${limit}`),
  cctpLatest: (limit = 50) =>
    getJson<{ messages: CctpMessage[] }>(`/cctp/latest?limit=${limit}`),
  cctpByDestination: () =>
    getJson<{ by_destination: CctpVolume[] }>(`/cctp/by-destination`),
  swapsLatest: (limit = 20) =>
    getJson<{ swaps: Swap[] }>(`/swaps/latest?limit=${limit}`),
  khLatest: (limit = 20) =>
    getJson<{ executions: KhExecution[] }>(`/kh/latest?limit=${limit}`),
};
