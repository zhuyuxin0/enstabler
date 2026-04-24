# Enstabler

Don't trust stablecoin flows — verify them.

Autonomous agent monitoring real-time stablecoin flows (USDT, USDC, DAI, PYUSD) on Ethereum and Arbitrum, classifying each transfer, and publishing verified flow risk scores on-chain.

## Stack

- **Backend**: Python 3.11+, FastAPI
- **Contracts**: Solidity 0.8.24 (evmVersion cancun), Hardhat
- **Chain**: 0G Galileo testnet for writes; Ethereum + Arbitrum mainnet for reads
- **Frontend**: React (coming in M5)

## Local dev

```bash
# Python backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn agent.server:app --reload --port 8000

# Contracts
cd contracts
npm install
npx hardhat run deploy.js --network galileo
```

## Deployed contracts (0G Galileo, chainId 16602)

- `FlowRiskOracle`: [`0x6A5861f8bc5b884a6B605Bec809d6Eb2478D052C`](https://chainscan-galileo.0g.ai/address/0x6A5861f8bc5b884a6B605Bec809d6Eb2478D052C)
