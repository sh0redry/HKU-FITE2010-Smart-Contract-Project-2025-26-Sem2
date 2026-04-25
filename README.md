# Stock Hedge Insurance

Quick links:

- [Chinese Presentation Flow](docs/PRESENTATION_FLOW_CN.md)

`Stock Hedge Insurance` is a Solidity-based stock insurance and LP underwriting system. Buyers pay a premium to insure against a defined stock move over a chosen duration, while liquidity providers supply the settlement capital and earn underwriting income unless a payout is triggered.

The project is built as a modular on-chain derivatives MVP with:

- U.S. and Hong Kong stock support
- downside and upside insurance products
- market-hours gating per exchange
- oracle abstraction and fallback handling
- LP reserve accounting and share tracking
- role-based governance and pause controls
- buyer, admin, and simulator frontends
- local/demo/testnet deployment workflows

## What The System Does

At a high level, the protocol supports this flow:

1. A buyer selects a stock, direction, trigger band, notional, deductible, payout cap, and duration.
2. The pricing engine reads the current spot price plus symbol-level risk parameters and calculates a premium.
3. The vault locks the maximum payout amount as reserved liquidity.
4. The buyer pays the premium in the settlement asset.
5. At expiry, the settlement path reads the allowed oracle price and calculates any payout.
6. If the insured move happened, the buyer receives a claim from the vault.
7. If not, the reserved liquidity is released and the premium remains as LP underwriting income.

## Quick Start: Testing and Local Run

Use this as the default path to verify the repo and run the static frontends against a local Hardhat node.

### Prerequisites

- **Node.js** 18+ and **npm**
- **Python 3** (for `npm run serve`, a simple static server; any other HTTP static server is fine)
- A browser with **MetaMask** (or another injected wallet) for buyer/admin flows
- (Optional) `.env` copied from `.env.example` for live market charts and `sync:market` scripts

### 1) Install

```bash
git clone <repository-url>
cd stock-hedge-insurance
npm install
```

### 2) Tests (recommended before demos)

| Command | Purpose |
|--------|--------|
| `npm test` or `npm run test` | Full Hardhat test suite (default entry) |
| `npm run test:all` | Same as full suite, prints a success line when all pass |
| `npm run test:unit` | `InsuranceVault` + `PricingOracle` unit tests only |
| `npm run test:integration` | `test/integration/SystemIntegration.js` |
| `npm run test:fuzz` | Fuzz tests on `PolicyFactory` |
| `npm run test:stress` | `ExtremeMarketStress` scenario |

Compile (if you changed contracts):

```bash
npm run compile
```

### 3) Frontend runtime config (for live / intraday charts)

1. Copy `.env.example` to `.env` and set at least:
   - `MARKET_DATA_PROVIDER` — default `yfinance`; use `alpha-vantage` if you prefer Alpha Vantage.
   - If using Alpha Vantage: `ALPHA_VANTAGE_API_KEY`
2. Generate the browser-safe file:

```bash
npm run build:runtime-config
# shorthand that also prints follow-up hints:
npm run setup
```

This creates `frontend/runtime-config.json` used by the buyer and admin pages for intraday data. The `MOCK` symbol can use embedded scenario data without an API key.

### 4) One-command prep script (optional)

```bash
bash start-demo.sh
```

Checks Node/npm/Python, installs dependencies if needed, compiles, runs the full test suite, runs `export-runtime-config`, and prints a short **three-terminal** recipe for the live demo (chain, deploy, static server). It does not start long-running processes in the background.

### 5) Local chain + deploy + open the UI (three terminals)

| Terminal | Command | When |
|----------|---------|------|
| **1** | `npm run node` | First; keep it running (Hardhat, chain id **31337**) |
| **2** | `npm run deploy:local` | After node is listening; deploys and writes `frontend/deployments/localhost.json` |
| **3** | `npm run serve` | Serves the `frontend/` directory on **port 8080** |

**Browser URLs**

- Buyer: `http://127.0.0.1:8080/index.html`
- Admin: `http://127.0.0.1:8080/admin.html`
- Scenario simulator (no chain required): `http://127.0.0.1:8080/simulation.html`

**MetaMask (local network)**

- Network name: e.g. `Hardhat Local`
- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency: `ETH` (or any symbol; gas is free on local node)

Import the first Hardhat test account if you need the deployer / `MOCK` price-feed owner; addresses are in the deploy script output and `localhost.json` + `admin` role hints.

**Alternative deploy flavor**

- `npm run deploy:demo` — demo-style deployment to the same `localhost` network (see `scripts/deploy-demo.js` for details).

### 6) Update mock feeds with live market data (optional)

If your `.env` and deployed addresses are set:

```bash
npm run sync:market
# testnet:
npm run sync:market:sepolia
```

---

For testnet deploy (`sepolia`, `base-sepolia`), RPC keys, and full env notes, use `docs/DEPLOYMENT_GUIDE.md` and `.env.example`.

## Product Scope

### Supported markets

The current whitelist includes:

- U.S. equities:
  - `AAPL`
  - `TSLA`
  - `NVDA`
  - `MSFT`
- Hong Kong equities:
  - `0700HK`
  - `9988HK`
  - `0005HK`
- Presentation-only demo market:
  - `MOCK`

### Supported policy types

- `Downside Protection`
- `Upside Protection`

### Buyer-configurable policy terms

- trigger band from `5%` to `20%`
- `notional`
- `deductible`
- `payoutCap`
- policy duration

### Settlement asset

- `MockUSDC` in the current implementation

## System Architecture

The project is intentionally split into separate modules so that custody, pricing, lifecycle management, data ingestion, and governance remain isolated.

### Core contracts

- `contracts/core/PolicyFactory.sol`
  Main policy lifecycle contract. It creates policies, stores policy state, enforces underwriting risk checks, supports cancellation after a lock delay, and settles claims.
- `contracts/core/InsuranceVault.sol`
  LP vault that holds settlement assets, mints LP shares, locks reserves, collects premiums, and pays claims.
- `contracts/engines/PricingOracle.sol`
  Lightweight on-chain pricing layer that combines spot price, risk parameters, utilization, direction, term, and market-hour rules.

### Oracle and risk layer

- `contracts/interfaces/IOracleAdapter.sol`
  Oracle abstraction so the pricing engine does not depend directly on raw feeds.
- `contracts/adapters/ChainlinkOracleAdapter.sol`
  Chainlink-style adapter with primary/fallback feeds, decimal normalization, and staleness checks.
- `contracts/interfaces/IRiskParameterProvider.sol`
  Interface for symbol-level risk snapshots.
- `contracts/mocks/MockRiskParameterProvider.sol`
  Demo implementation of the risk provider used for local and demo environments.

### Automation

- `contracts/automation/PolicySettlementAutomation.sol`
  Keeper-compatible settlement worker that scans active policies and batch-settles ready expiries.

### Demo and mock infrastructure

- `contracts/mocks/MockUSDC.sol`
  Mock 6-decimal settlement token.
- `contracts/mocks/MockPriceFeed.sol`
  Mock Chainlink-style price feed.
- `contracts/mocks/StockHedgeDemoDeployer.sol`
  Remix-oriented demo deployer that wires together a full stack for quick testing.

## Pricing Framework

The pricing architecture is split into two layers.

### Off-chain or provider-side risk inputs

Each symbol has a `RiskSnapshot` that includes:

- `impliedVolBps`
- `downsideSkewBps`
- `upsideSkewBps`
- `shortTermMultiplierBps`
- `mediumTermMultiplierBps`
- `longTermMultiplierBps`
- `downsideInventoryPressureBps`
- `upsideInventoryPressureBps`
- `stressPremiumBps`
- `riskScoreBps`
- `updatedAt`
- `sourceTag`

This design leaves room for future integration with:

- `Chainlink Functions`
- a backend risk engine
- scheduled off-chain risk updates

### On-chain lightweight pricing

`PricingOracle` computes the final quote using:

- current spot price
- trigger-selected strike
- symbol-specific vol and skew
- term structure multiplier
- direction-specific inventory pressure
- utilization surcharge from the vault
- stress premium and risk score
- payout-cap effect
- overnight gap surcharge when a policy crosses a market close

This keeps the chain-facing logic explainable and gas-bounded, while reserving more complex estimation for off-chain systems.

## Market Session Logic

The protocol does not allow policies to be bought when the relevant exchange is closed, as long as `enforceMarketHours` is enabled for that market.

### U.S. market handling

- U.S. equity sessions are interpreted in U.S. local market time
- daylight saving time is handled
- holiday closures can be configured
- purchases can be blocked near the close with `closeBufferMinutes`
- after-hours expiries can use `NextMarketOpen` settlement mode

### Hong Kong market handling

- Hong Kong symbols use Hong Kong local market time
- Hong Kong symbols are also restricted to their market session
- Hong Kong equities use a split trading day with a lunch recess
- the current implementation models a morning session from `09:30-12:00` HKT and an afternoon session from `13:00-16:00` HKT
- policies cannot be quoted or bought during the `12:00-13:00` HKT lunch break

### Important note

The project is designed so U.S. and Hong Kong markets can cover more hours of the day together, but neither market is purchasable while that market itself is closed.

## Oracle And Settlement Design

The oracle path is abstracted through `IOracleAdapter`.

### Current behavior

- primary oracle is used when valid and fresh
- fallback oracle is used when primary data is stale or invalid and fallback is enabled
- quoting and settlement revert if no valid source is available
- some markets can explicitly reject fallback usage

### Live market data sync

The repo now includes a provider-switchable free-data sync path. The default provider is `yfinance`, while `Alpha Vantage` remains available as a fallback option:

- `scripts/sync-market-data.js`
- `scripts/market-data-utils.js`

The sync flow is:

1. fetch the latest daily close for supported U.S. and Hong Kong symbols from the configured provider
2. estimate a lightweight realized-volatility snapshot from recent history
3. push the latest price into the deployed `MockPriceFeed`
4. push a refreshed `RiskSnapshot` into `MockRiskParameterProvider`

This keeps the on-chain contracts unchanged while still letting local, demo, and testnet deployments ingest real market data through an off-chain updater.

### Settlement behavior

- if the market is open at expiry, settlement can proceed after expiry
- if the market is closed and the market uses `NextMarketOpen`, settlement is delayed until the next valid open session
- once settlement is allowed, the current oracle price is used to calculate payout

## Risk Controls

The underwriting path includes multiple explicit controls.

### Exposure controls

- per-symbol exposure caps
- downside exposure caps
- upside exposure caps
- short-term exposure caps
- medium-term exposure caps
- long-term exposure caps

### Solvency controls

- projected utilization cap
- minimum liquidity buffer
- reserve availability check before issuing a new policy

### Session and market controls

- market-hours enforcement
- close-buffer enforcement
- holiday closures
- fallback oracle gating

### Pause controls

- underwriting can be paused
- quoting can be paused
- separate administrative roles control different emergency actions

## Governance Model

The system uses OpenZeppelin-based role separation for governance-sensitive modules.

### Roles

- `governor`
  Can act as default admin and unpause core flows.
- `riskManager`
  Controls risk limits, market listings, market session parameters, and calendar closures.
- `oracleManager`
  Controls oracle adapter and risk provider wiring.
- `pauser`
  Can pause underwriting or quoting when needed.

### OpenZeppelin usage

- `AccessControl + Pausable` in `PolicyFactory`
- `AccessControl + Pausable` in `PricingOracle`
- `Ownable` in `InsuranceVault`
- `Ownable` in `ChainlinkOracleAdapter`
- `Ownable` in `MockRiskParameterProvider`
- `Ownable` in `MockUSDC`

## Frontend Structure

The repo includes three main frontends.

### Buyer page

- `frontend/index.html`

This page supports:

- wallet connection
- chain-aware deployment loading
- presentation presets for U.S., Hong Kong, and `MOCK` demo flows
- quote generation
- policy purchase
- cancellation
- settlement
- LP deposit and withdraw
- policy portfolio status display
- LP metrics and charts
- readable custom revert decoding

### Admin page

- `frontend/admin.html`

This page supports:

- role-aware operational use
- exposure and vault monitoring
- accelerated `MOCK` market playback controls for presentation demos
- pause and unpause actions
- risk-limit updates
- symbol exposure limit updates
- market configuration updates
- calendar closure management
- oracle and risk-provider rewiring

### Scenario simulator

- `frontend/simulation.html`

This page supports:

- off-chain scenario replay
- multiple-policy batch simulation
- one-click `MOCK` presentation pack loading
- accelerated month-long `MOCK` timeline playback
- sample path underwriting analysis
- payout and revenue inspection without sending transactions

### Shared frontend utilities

- `frontend/shared.js`

This file centralizes:

- chain detection
- deployment-file loading
- custom error decoding
- shared formatting and policy status helpers

## Deployment Layout

The project supports separate deployment flows for different environments.

### Deployment scripts

- `scripts/deploy.js`
  Wrapper deployment entrypoint
- `scripts/deploy-local.js`
  Writes `frontend/deployments/localhost.json`
- `scripts/deploy-demo.js`
  Writes `frontend/deployments/demo.json`
- `scripts/deploy-testnet.js`
  Writes testnet deployment output such as `sepolia.json` or `base-sepolia.json`
- `scripts/deploy-shared.js`
  Shared deployment core used by the environment-specific scripts

### Supported deployment targets

- local Hardhat node
- local demo environment
- Sepolia
- Base Sepolia

### Environment configuration

See:

- `.env.example`
- `docs/DEPLOYMENT_GUIDE.md`

## Testing And Quality

The repository now includes a fuller testing matrix instead of relying on one end-to-end script.

### Regression suite

- `test/Phase1Lifecycle.js`

Covers the full lifecycle and main protocol behavior:

- quoting
- buying
- cancelling
- settling
- market-hours gating
- fallback oracle handling
- role separation
- exposure and solvency controls

### Unit tests

- `test/unit/InsuranceVault.unit.js`
- `test/unit/PricingOracle.unit.js`

Focus on isolated vault and pricing behavior.

### Integration tests

- `test/integration/SystemIntegration.js`

Focus on multi-contract interaction and aggregate state changes.

### Fuzz-style tests

- `test/fuzz/PolicyFactory.fuzz.js`

Use randomized parameter combinations to validate core invariants.

### Stress tests

- `test/stress/ExtremeMarketStress.js`

Exercise the protocol under extreme move and multi-policy reserve pressure.

### Gas tooling

- `scripts/gas-report.js`

Current gas snapshot verifies estimates for:

- `purchasePolicy`
- `deposit`
- `withdraw`

## Security And Review Assets

The repo includes supporting documents for review and defense:

- `docs/SECURITY_CHECKLIST.md`
- `docs/DEPLOYMENT_GUIDE.md`
- `docs/ARCHITECTURE.md`
- `docs/DEFENSE_BRIEF.md`
- `docs/GAS_NOTES.md`

These documents summarize:

- access control assumptions
- reentrancy and accounting considerations
- oracle freshness and fallback risks
- deployment steps
- architectural diagrams
- defense-ready talking points

## Local Development Workflow

The full step-by-step flow (install, tests, runtime config, three-terminal local run, optional `start-demo.sh`, and MetaMask settings) is documented in **[Quick Start: Testing and Local Run](#quick-start-testing-and-local-run)**.

Additional pointers:

- **Testnet deploy**: `npm run deploy:sepolia` and `npm run deploy:base-sepolia` — see `docs/DEPLOYMENT_GUIDE.md` and `hardhat.config` networks.
- **`sync:market`** may require the same market-data and RPC variables as in `.env.example` (e.g. Alpha Vantage for some flows).

## Useful Commands

```bash
# build & test
npm run compile
npm run test
npm run test:all
npm run test:unit
npm run test:integration
npm run test:fuzz
npm run test:stress

# local run
npm run node
npm run deploy:local
npm run deploy:demo
npm run serve
npm run setup
bash start-demo.sh

# testnet & ops
npm run deploy:sepolia
npm run deploy:base-sepolia
npm run gas:report
npm run sync:market
npm run sync:market:sepolia
npm run build:runtime-config
```

## Current Implementation Boundaries

This repository is much more structured than a throwaway demo, but it is still an educational MVP rather than production infrastructure.

Important current boundaries:

- settlement uses the current allowed oracle spot at settlement time
- exchange calendars are simplified rather than fully production-grade
- live market data currently enters through an off-chain updater rather than a decentralized production oracle network
- the default market-data path is `yfinance`, which is convenient for demos and coursework but is not a production oracle
- provider symbol mappings for Hong Kong equities are configurable and may need adjustment depending on the chosen data source
- the system has not undergone an external professional audit

## Summary

This project already implements a full stock insurance framework, not just a single contract demo. It includes modular custody, pricing, oracle abstraction, reserve accounting, governance, automation, multi-market session handling, separate buyer/admin frontends, split deployment workflows, and a layered test matrix. That makes it suitable both for coursework demonstration and for explaining how a more production-ready on-chain stock insurance protocol could be structured.
