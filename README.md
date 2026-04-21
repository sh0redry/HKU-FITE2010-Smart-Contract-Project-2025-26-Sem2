# Stock Hedge Insurance MVP

This repository contains a U.S. stock insurance demo focused on American equities such as `AAPL`, `TSLA`, `NVDA`, and `MSFT`, with `MockUSDC` used as the settlement asset.

The project now includes the Phase 4 pricing upgrade:

- chain on-chain pricing is intentionally lightweight
- richer risk parameters are supplied by a separate risk provider contract
- pricing differentiates by symbol, direction, term bucket, vault utilization, and inventory stress
- the architecture is ready for a future off-chain risk engine such as `Chainlink Functions` or a backend service
- Phase 5 market logic adds U.S. equity session handling, DST-aware clocks, holiday closures, close-buffer purchase blocking, and next-open settlement rules

## Architecture

### On-chain components

- `contracts/core/InsuranceVault.sol`
  LP vault for `MockUSDC` deposits, share accounting, premium collection, claim payouts, and reserve locking.
- `contracts/core/PolicyFactory.sol`
  Creates policies, enforces product terms, stores lifecycle data, supports cancellation after a lock delay, and settles claims.
- `contracts/engines/PricingOracle.sol`
  Performs lightweight final pricing on-chain using:
  - spot price
  - base premium
  - utilization surcharge
  - direction-specific skew
  - inventory pressure
  - term structure multipliers
  - stress premium and risk score
- `contracts/interfaces/IRiskParameterProvider.sol`
  Interface for externalized risk snapshots.
- `contracts/mocks/MockRiskParameterProvider.sol`
  Owner-managed demo provider that mimics a future off-chain risk engine feed.

### Data and testing components

- `contracts/mocks/MockUSDC.sol`
  Mock 6-decimal settlement token for local testing.
- `contracts/mocks/MockPriceFeed.sol`
  Local mock spot-price feed.
- `contracts/mocks/StockHedgeDemoDeployer.sol`
  Deploys a ready-to-test Remix demo stack with four supported U.S. symbols and seeded risk snapshots.
- `scripts/deploy.js`
  Deploys the local Hardhat stack, seeds balances, injects initial LP liquidity, configures market snapshots, and writes frontend addresses.
- `test/Phase1Lifecycle.js`
  Hardhat regression suite covering lifecycle, vault accounting, multi-symbol support, cancellation, market-hours checks, and Phase 4 risk-based pricing behavior.

### Frontends

- `frontend/index.html`
  Manual chain-connected test page for quote, buy, cancel, settle, deposit, and withdraw flows.
- `frontend/simulation.html`
  Off-chain scenario replay page that simulates one or more policies across sample stock-price paths and shows premium, payout, and protocol revenue.

## Phase 4 pricing model

The pricing model is now split into two layers.

### Layer 1: off-chain or provider layer

The risk provider supplies a `RiskSnapshot` per symbol with:

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

In the demo, these values come from `MockRiskParameterProvider`. In a fuller version, the same interface can be driven by:

- `Chainlink Functions`
- an internal backend risk engine
- a scheduled off-chain process computing IV, skew, inventory stress, and risk scores

### Layer 2: on-chain lightweight pricing

`PricingOracle` reads the current spot price and the latest risk snapshot, then calculates:

- strike price from the chosen trigger
- estimated trigger probability
- direction-specific skew premium
- term multiplier from the selected duration bucket
- inventory pressure premium
- utilization surcharge from current vault usage
- stress premium and risk-score adjustments

This keeps the chain-facing logic simple enough for testing while leaving the complex market estimation off-chain.

## Phase 5 market logic

The market-hours layer is now more specific to U.S. equities.

- `PricingOracle` can interpret session times as U.S. local market times instead of raw UTC windows
- daylight saving time is handled for U.S. Eastern market sessions
- owner-managed holiday closures can disable quoting and settlement windows for observed market holidays
- quotes can be blocked near the close through a configurable `closeBufferMinutes`
- policies that cross a market close can receive an `overnightGapSurchargeBps`
- markets can be configured to settle against the first allowed post-expiry market-open window instead of immediately during a closed session

The current closed-market settlement rule is:

- if a policy expires while the market is open, it can settle once expiry has passed
- if a policy expires while the market is closed and the market uses `NextMarketOpen` settlement mode, settlement is blocked until the next valid open session
- the demo then reads the current oracle price when settlement becomes allowed

## Supported symbols

The current whitelist includes:

- `AAPL`
- `TSLA`
- `NVDA`
- `MSFT`

Each symbol has its own spot price and its own baseline risk profile, so quotes are no longer nearly identical across different names.

## Product model

Policies currently support:

- `Downside Protection`
- `Upside Protection`
- trigger selection from `5%` to `20%`
- `notional`
- `deductible`
- `payoutCap`
- `createdAt`
- `settledAt`
- cancellation after the lock delay with no premium refund

Premiums, reserves, and payouts are all denominated in `MockUSDC`.

## Local test flow

1. Install dependencies:

```bash
npm install
```

2. Run the Hardhat regression suite:

```bash
npx hardhat test
```

3. Start a local chain:

```bash
npm run node
```

4. In a second terminal, deploy the local stack:

```bash
npm run deploy:local
```

5. Import one of the Hardhat test accounts into MetaMask and connect MetaMask to:
   - RPC URL: `http://127.0.0.1:8545`
   - Chain ID: `31337`
6. Serve the project root or `frontend` folder over HTTP.
7. Open:
   - `frontend/index.html`
   - `frontend/simulation.html`
8. The manual page will try to auto-load addresses from `frontend/deployments/localhost.json`.

## Demo defaults

- settlement asset: `MockUSDC`
- allowed trigger range: `5%` to `20%`
- market-hours enforcement: disabled in demo deployment for easier testing
- max notional per policy: `50,000 USDC`
- local deploy script seeds:
  - `200,000 USDC` into the vault from the LP account
  - `250,000 USDC` to the LP wallet
  - `50,000 USDC` to the buyer wallet
  - `100,000 USDC` to the deployer wallet

## Current assumptions

- policies settle against the current oracle spot price when `settlePolicy` is called
- the risk provider snapshot is assumed fresh enough for the quote unless `updatedAt` is missing
- this is still an educational MVP rather than production-ready insurance infrastructure
- U.S. market sessions are modeled with a simple UTC trading window, not a full holiday and DST calendar

## Hardhat coverage

The current Hardhat suite covers:

- quote and purchase for a downside policy
- full downside lifecycle with claim payout
- reserve release when no claim is due
- settlement blocked before expiry
- unsupported symbol rejection
- whitelist support for `AAPL / TSLA / NVDA / MSFT`
- price differentiation from symbol-specific risk snapshots
- trigger validation in the `5%` to `20%` band
- missing risk snapshot rejection
- cancellation after the lock delay with no premium refund
- cancellation blocked during the lock delay
- LP withdrawals blocked while liquidity remains reserved
- market-hours enforcement checks
- DST-aware U.S. market open checks
- holiday closure checks
- near-close purchase blocking
- overnight gap surcharge behavior
- next-open settlement gating for after-hours expiry
- utilization validation above `100%`
- underwriting result and LP share-price tracking after profitable underwriting
