// One-time 0G Compute setup:
//  1. Connect broker with OG_PRIVATE_KEY on 0G Galileo
//  2. Register a Ledger account (addLedger) with an initial OG deposit
//  3. List inference services
//  4. Pick a chat-style provider that's online
//  5. Acknowledge the provider's TEE signer
//  6. Transfer OG from the Ledger to that provider
//
// Run:  node scripts/setup_compute.js
//
// Idempotent: safe to re-run. Skips steps that are already done.

import "dotenv/config";
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

const RPC_URL = process.env.OG_RPC_URL || "https://evmrpc-testnet.0g.ai";
const PRIVATE_KEY = process.env.OG_PRIVATE_KEY;

const INITIAL_LEDGER_OG = 5;     // deposited into the ledger up front
const PROVIDER_FUND_OG = 2;      // transferred to the chosen provider

if (!PRIVATE_KEY) {
  console.error("OG_PRIVATE_KEY not set in .env");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

console.log(`wallet:  ${wallet.address}`);
const balanceWei = await provider.getBalance(wallet.address);
const balance = Number(ethers.formatEther(balanceWei));
console.log(`balance: ${balance.toFixed(4)} OG`);
if (balance < INITIAL_LEDGER_OG + 0.5) {
  console.error(`need at least ${INITIAL_LEDGER_OG + 0.5} OG; please top up`);
  process.exit(1);
}

console.log("creating broker…");
const broker = await createZGComputeNetworkBroker(wallet);

// ---------- Ledger ----------
let ledger = null;
try {
  ledger = await broker.ledger.getLedger();
  console.log(`ledger: existing (totalBalance=${ethers.formatEther(ledger.totalBalance)} OG, available=${ethers.formatEther(ledger.availableBalance)} OG)`);
} catch (e) {
  console.log("ledger: not found, creating with initial deposit…");
  await broker.ledger.addLedger(INITIAL_LEDGER_OG);
  ledger = await broker.ledger.getLedger();
  console.log(`ledger: created (totalBalance=${ethers.formatEther(ledger.totalBalance)} OG)`);
}

// Top up if available is too low to fund a provider
const available = Number(ethers.formatEther(ledger.availableBalance));
if (available < PROVIDER_FUND_OG + 0.5) {
  const topup = (PROVIDER_FUND_OG + 1) - available;
  console.log(`ledger: depositing ${topup.toFixed(2)} OG…`);
  await broker.ledger.depositFund(topup);
  ledger = await broker.ledger.getLedger();
  console.log(`ledger: now available=${ethers.formatEther(ledger.availableBalance)} OG`);
}

// ---------- Pick a provider ----------
console.log("listing inference services…");
const services = await broker.inference.listService();
console.log(`found ${services.length} services`);
for (const s of services) {
  console.log(`  - ${s.provider}  model=${s.model}  url=${s.url}`);
}

// Prefer a chat-style model we can use for explanations
const preferences = ["qwen", "llama", "instruct", "chat"];
let chosen = null;
for (const pref of preferences) {
  chosen = services.find((s) => (s.model || "").toLowerCase().includes(pref));
  if (chosen) break;
}
chosen = chosen || services[0];
if (!chosen) {
  console.error("no inference services available");
  process.exit(1);
}
console.log(`chosen: ${chosen.provider}  model=${chosen.model}`);

// ---------- Acknowledge provider ----------
console.log("acknowledging provider TEE signer…");
try {
  await broker.inference.acknowledgeProviderSigner(chosen.provider);
  console.log("  acknowledged");
} catch (e) {
  // already acknowledged is fine
  if (String(e).match(/already|exists/i)) {
    console.log("  already acknowledged");
  } else {
    console.warn(`  acknowledge warning: ${e.message || e}`);
  }
}

// ---------- Fund provider ----------
console.log(`transferring ${PROVIDER_FUND_OG} OG to provider…`);
try {
  await broker.ledger.transferFund(chosen.provider, "inference", PROVIDER_FUND_OG);
  console.log("  funded");
} catch (e) {
  // If already funded above the threshold, this can fail; report and continue
  console.warn(`  transferFund: ${e.message || e}`);
}

// ---------- Verify ----------
const account = await broker.inference.getAccount(chosen.provider);
console.log(`account@provider: balance=${ethers.formatEther(account.balance)} OG  pendingRefund=${ethers.formatEther(account.pendingRefund)} OG`);

console.log("\nSETUP COMPLETE");
console.log(`Provider: ${chosen.provider}`);
console.log(`Model:    ${chosen.model}`);
console.log("python-0g should now find this provider via get_all_services().");
