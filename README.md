# Stock Hedge Insurance MVP

This repository now contains a U.S. stock insurance demo focused on American equities such as `AAPL`, `TSLA`, `NVDA`, and `MSFT`, with `MockUSDC` used as the settlement asset.

## Included contracts

- `contracts/engines/PricingOracle.sol`: quotes premiums from spot price, volatility, duration, and vault utilization.
- `contracts/core/InsuranceVault.sol`: ERC20 vault for LP deposits, reserves, premium collection, claim payouts, and LP share accounting.
- `contracts/core/PolicyFactory.sol`: creates trigger-based upside/downside policies, supports cancellation after a lock delay, and settles them after expiry.
- `contracts/mocks/MockUSDC.sol`: mock 6-decimal settlement token for local testing.
- `contracts/mocks/MockPriceFeed.sol`: local mock feed for spot price and volatility.
- `contracts/mocks/StockHedgeDemoDeployer.sol`: deploys a ready-to-test multi-stock + MockUSDC demo stack for Remix.
- `test/Phase1Lifecycle.js`: lifecycle, product-term, and asset-model regression tests for quote, purchase, cancellation, settlement, vault safety, and LP accounting.
- `hardhat.config.js`: local Hardhat test configuration.
- `package.json`: Node scripts and Hardhat dependencies.
- `scripts/deploy.js`: deploys the full local stack, seeds MockUSDC balances, injects initial LP liquidity, and writes frontend addresses.
- `frontend/index.html`: manual chain-connected test page.
- `frontend/simulation.html`: historical scenario simulator for fast off-chain underwriting playback.

## Local frontend path

1. Install dependencies:

```bash
npm install
```

2. Start a local Hardhat chain:

```bash
npm run node
```

3. In a second terminal, deploy the stack and seed initial liquidity:

```bash
npm run deploy:local
```

4. Import one of the Hardhat test accounts into MetaMask and connect MetaMask to `http://127.0.0.1:8545` with chain id `31337`.
5. Serve the project root or the `frontend` folder over HTTP.
6. Open `frontend/index.html`.
7. The page will try to auto-load addresses from `frontend/deployments/localhost.json`.
8. Connect the LP wallet or buyer wallet and test deposit, quote, purchase, cancellation, policy loading, and settlement.

## Demo defaults

- Symbol: `AAPL`
- Spot price: `185 USD`
- Volatility feed: `28.00%`
- Market-hours enforcement: disabled in the demo deployer so you can test anytime
- Coverage cap per policy: `50,000 USDC`
- Allowed trigger range: `5%` to `20%`
- Product types: `Downside Protection` or `Upside Protection`
- Local deploy script seeds:
  - `200,000 USDC` into the vault from the LP account
  - `250,000 USDC` to the LP wallet
  - `50,000 USDC` to the buyer wallet

## Important assumptions

- Policies settle against the current oracle price when `settlePolicy` is called.
- Coverage, premiums, and payouts are denominated in `MockUSDC`.
- The volatility feed is expressed in basis points-like percent terms for pricing, not as a full options model.
- Trigger-based products let the user choose a move threshold between `5%` and `20%`, with the contract deriving `strikePrice` from the entry price.
- Cancellation is allowed only after the lock delay and does not refund premiums.
- This is an educational MVP, not production-ready insurance infrastructure.

## Phase 3 complete scope

Phase 3 adds a more complete insurance-product model. The repository now covers:

- `MockUSDC` settlement instead of native ETH
- ERC20 vault deposits, withdrawals, premiums, and claim payouts
- Initial local LP liquidity injection through the deploy script
- Complete policy fields:
  - `strikePrice`
  - `notional`
  - `deductible`
  - `payoutCap`
  - `createdAt`
  - `settledAt`
- Trigger-based downside and upside insurance
- User-selectable move thresholds from `5%` to `20%`
- Cancellation after a lock delay with no premium refund
- Multi-symbol whitelist:
  - `AAPL`
  - `TSLA`
  - `NVDA`
  - `MSFT`
- Separate accounting for:
  - `totalAssets`
  - `totalReserved`
  - `realizedPremiums`
  - `totalClaimsPaid`
  - LP `sharePrice`
  - `netUnderwritingResult`
- Two frontend pages:
  - manual chain-connected test page
  - historical scenario simulator
- Automated lifecycle, product-term, and asset-model tests

## Recommended test flow for each phase

Every future phase should keep both of these test paths working:

1. Manual smoke test in Remix
2. Automated regression test in Hardhat

### Manual smoke test in Remix

Use this when you want a fast UI-free sanity check:

1. Deploy `contracts/mocks/StockHedgeDemoDeployer.sol`
2. Read `mockUsdc()`, `insuranceVault()`, `policyFactory()`, and `aaplSpotFeed()`
3. Mint or use the seeded `MockUSDC` balance in the owner wallet
4. Approve `InsuranceVault` and deposit LP funds
5. Approve `InsuranceVault` for policy premium collection
6. Preview and purchase a policy with:
   - symbol
   - direction
   - trigger percent
   - notional
   - deductible
   - payout cap
7. Optionally wait past the lock delay and test `cancelPolicy`
8. Change the mock spot price in `MockPriceFeed`
9. Wait until expiry and settle the policy
10. Confirm reserve release, payout, and final vault accounting metrics

### Automated regression test in Hardhat

Once Node.js dependencies are installed, run:

```bash
npm install
npx hardhat test
```

The current Hardhat suite covers:

- `testQuoteAndPurchaseDownsidePolicy`
- `testFullDownsideLifecyclePaysClaim`
- `testSettleWithoutLossReleasesLiquidity`
- `testCannotSettleBeforeExpiry`
- `testPurchaseRevertsForUnsupportedSymbol`
- `testSupportsMultipleWhitelistedSymbols`
- `testBlocksTriggersOutsideThe5To20PercentRange`
- `testCancelsAPolicyAfterTheLockDelayWithoutRefundingPremium`
- `testBlocksCancellationDuringTheLockDelay`
- `testVaultBlocksOverWithdrawalWhileCoverageIsReserved`
- `testPricingRespectsMarketHoursWhenEnabled`
- `testQuoteRejectsUtilizationAbove100Percent`
- `testTracksUnderwritingMetricsAndLPSharePriceAfterProfit`

## Phase 3 exit criteria

Do not move to phase 4 unless all of the following hold:

- Quote preview works for supported U.S. stock symbols
- Policy purchase succeeds when the vault has enough free liquidity
- Policy purchase fails for unsupported symbols or insufficient liquidity
- Settlement pays the insured user when price moves against them
- Settlement releases all remaining reserves when no payout is due
- Policies store strike, notional, deductible, payout cap, createdAt, and settledAt correctly
- Trigger selection is restricted to `5%` through `20%`
- User can choose downside or upside insurance
- Cancellation is blocked during the lock delay and allowed afterwards without premium refund
- The whitelist supports at least `AAPL / TSLA / NVDA / MSFT`
- Vault withdrawals are blocked when locked liquidity would be violated
- Premiums and claims are fully settled in `MockUSDC`
- LP share price increases when underwriting profit is realized
- Underwriting metrics are queryable from the vault
- Market-hours checks behave correctly when enabled
- The manual page, simulator page, Remix smoke test, and Hardhat regression suite all pass
