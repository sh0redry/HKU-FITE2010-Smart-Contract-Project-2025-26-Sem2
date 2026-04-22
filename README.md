# Stock Hedge Insurance MVP

This repository contains a stock insurance demo with `MockUSDC` settlement, now covering both U.S. equities and selected Hong Kong equities so the demo can offer staggered market coverage across more of the day.

The project now includes the Phase 4 pricing upgrade:

- chain on-chain pricing is intentionally lightweight
- richer risk parameters are supplied by a separate risk provider contract
- pricing differentiates by symbol, direction, term bucket, vault utilization, and inventory stress
- the architecture is ready for a future off-chain risk engine such as `Chainlink Functions` or a backend service
- Phase 5 market logic adds U.S. equity session handling, DST-aware clocks, holiday closures, close-buffer purchase blocking, and next-open settlement rules
- Phase 6 adds an oracle-adapter layer, a Chainlink-style price source path, fallback-oracle handling, and keeper-based automatic settlement
- Phase 8 adds OpenZeppelin-based governance roles, a split buyer/admin frontend, and Hong Kong market support

## Architecture

### On-chain components

- `contracts/core/InsuranceVault.sol`
  LP vault for `MockUSDC` deposits, share accounting, premium collection, claim payouts, and reserve locking. It now uses OpenZeppelin `Ownable`.
- `contracts/core/PolicyFactory.sol`
  Creates policies, enforces product terms, stores lifecycle data, supports cancellation after a lock delay, settles claims, and now uses OpenZeppelin `AccessControl` plus `Pausable` for underwriting governance.
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
- `contracts/interfaces/IOracleAdapter.sol`
  Interface for spot-price adapters so pricing never reads raw feeds directly.
- `contracts/mocks/MockRiskParameterProvider.sol`
  OpenZeppelin `Ownable` demo provider that mimics a future off-chain risk engine feed.
- `contracts/adapters/ChainlinkOracleAdapter.sol`
  OpenZeppelin `Ownable` Chainlink-style adapter that reads primary and fallback feeds, normalizes decimals, and enforces freshness via `maxStaleness`.
- `contracts/automation/PolicySettlementAutomation.sol`
  Keeper-compatible settlement worker that scans active policies and triggers batch settlement when policies are ready.

### Data and testing components

- `contracts/mocks/MockUSDC.sol`
  Mock 6-decimal settlement token for local testing.
- `contracts/mocks/MockPriceFeed.sol`
  Local mock spot-price feed.
- `contracts/mocks/StockHedgeDemoDeployer.sol`
  Deploys a ready-to-test Remix demo stack with U.S. and Hong Kong symbols plus seeded risk snapshots.
- `scripts/deploy.js`
  Deploys the local Hardhat stack, seeds balances, injects initial LP liquidity, configures market snapshots, and writes frontend addresses.
- `test/Phase1Lifecycle.js`
  Hardhat regression suite covering lifecycle, vault accounting, multi-symbol support, cancellation, market-hours checks, and Phase 4 risk-based pricing behavior.

### Frontends

- `frontend/index.html`
  Buyer-facing chain-connected page for quote, buy, cancel, settle, deposit, and withdraw flows, now with network-aware deployment loading, policy status tables, LP metrics, and quote visualizations.
- `frontend/simulation.html`
  Off-chain scenario replay page that simulates one or more policies across sample stock-price paths and shows premium, payout, and protocol revenue.
- `frontend/admin.html`
  Manager-facing monitoring and governance console for vault health, pauses, risk limits, market configs, and calendar closures.
- `frontend/shared.js`
  Shared frontend helper layer for chain detection, deployment-file loading, and custom error decoding.

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

## Phase 6 oracle and automation logic

The spot-price path is now split into an adapter layer.

- `PricingOracle` no longer depends on raw mock feeds
- spot prices are fetched through `IOracleAdapter`
- the provided concrete implementation is `ChainlinkOracleAdapter`
- each symbol can use:
  - a primary feed
  - an optional fallback feed
  - a freshness threshold

Current fallback behavior:

- if the primary feed is fresh and valid, it is used
- if the primary feed is stale or invalid and a valid fallback feed exists, the fallback is used
- if no valid source exists, quoting and settlement revert
- if a market disallows fallback usage, a fallback response is rejected

This gives you a clean path for:

- local testing with mock feeds
- testnet deployment with Chainlink-compatible feeds
- future replacement with another oracle adapter without rewriting `PricingOracle`

### Automation

`PolicySettlementAutomation` implements a keeper-style flow:

- `checkUpkeep` scans a page of active policies
- it filters for policies whose expiry has passed and whose settlement price is available
- `performUpkeep` batch-settles those policy ids through `PolicyFactory`

`PolicyFactory` now keeps an active-policy index to support this automation path.

## Supported symbols

The current whitelist includes:

- `AAPL`
- `TSLA`
- `NVDA`
- `MSFT`
- `0700HK`
- `9988HK`
- `0005HK`

Each symbol has its own spot price and its own baseline risk profile, so quotes are no longer nearly identical across different names.

## Phase 8 governance model

The platform now separates administrative responsibilities:

- `governor`
  Can unpause quoting and underwriting, and remains the default admin for role grants.
- `riskManager`
  Can update risk limits, exposure caps, market listings, market hours, and calendar closures.
- `oracleManager`
  Can rotate the oracle adapter and risk-parameter provider.
- `pauser`
  Can pause quoting and underwriting during abnormal conditions.

OpenZeppelin is now used in the governance-sensitive parts of the stack:

- `AccessControl` + `Pausable` in `PolicyFactory`
- `AccessControl` + `Pausable` in `PricingOracle`
- `Ownable` in `InsuranceVault`
- `Ownable` in `ChainlinkOracleAdapter`
- `Ownable` in `MockRiskParameterProvider`
- `Ownable` in `MockUSDC`

This also means you can use two separate frontends in local demos:

- a buyer wallet on `frontend/index.html`
- a manager wallet on `frontend/admin.html`

The deploy script now writes dedicated local accounts for:

- `governor`
- `riskManager`
- `oracleManager`
- `pauser`
- `lp`
- `buyer`

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
   - `frontend/admin.html`
8. The manual page will try to auto-load addresses from `frontend/deployments/localhost.json`.

## Phase 9 frontend upgrades

The buyer frontend is now aimed at real network use instead of only a local static demo:

- it detects the connected chain and tries to load the matching deployment file
- it supports `localhost`, `Sepolia`, and `Base Sepolia` deployment-file conventions
- it surfaces readable revert reasons by decoding custom Solidity errors
- it groups policies into `Active / Expired / Settled / Cancelled`
- it shows LP metrics such as TVL, utilization, withdrawable assets, and underwriting P&L
- it visualizes spot, strike, volatility, probability, and premium components with canvas charts

If you deploy to a real testnet, add one of these files:

- `frontend/deployments/sepolia.json`
- `frontend/deployments/base-sepolia.json`

You can use the included examples:

- `frontend/deployments/sepolia.example.json`
- `frontend/deployments/base-sepolia.example.json`

### Suggested local role usage

- Import `buyer` into MetaMask for `frontend/index.html`
- Import `governor`, `riskManager`, `oracleManager`, or `pauser` into MetaMask for `frontend/admin.html`
- Import `lp` if you want to test additional manual liquidity operations

## Demo defaults

- settlement asset: `MockUSDC`
- allowed trigger range: `5%` to `20%`
- market-hours enforcement: enabled by default for both U.S. and Hong Kong symbols
- max notional per policy: `50,000 USDC`
- local deploy script seeds:
  - `200,000 USDC` into the vault from the LP account
  - `250,000 USDC` to the LP wallet
  - `50,000 USDC` to the buyer wallet
  - `100,000 USDC` to the deployer wallet
- local deploy script also assigns separate governance role accounts for monitoring and parameter updates

## Current assumptions

- policies settle against the current oracle spot price when `settlePolicy` is called
- the risk provider snapshot is assumed fresh enough for the quote unless `updatedAt` is missing
- this is still an educational MVP rather than production-ready insurance infrastructure
- U.S. and Hong Kong market sessions are modeled with simplified local-session windows rather than full exchange calendars
- Hong Kong symbols are restricted to Hong Kong market hours as well; they are not purchasable while the Hong Kong market is closed

## Hardhat coverage

The current Hardhat suite covers:

- quote and purchase for a downside policy
- full downside lifecycle with claim payout
- reserve release when no claim is due
- settlement blocked before expiry
- unsupported symbol rejection
- whitelist support for `AAPL / TSLA / NVDA / MSFT / 0700HK / 9988HK / 0005HK`
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
- fallback oracle usage when the primary feed is stale
- keeper-based automatic settlement
- role separation for governor, risk, oracle, and pauser duties
- utilization validation above `100%`
- underwriting result and LP share-price tracking after profitable underwriting
