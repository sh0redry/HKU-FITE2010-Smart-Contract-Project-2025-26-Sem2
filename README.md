# Stock Hedge Insurance MVP

This repository now contains a simple U.S. stock insurance demo focused on American equities such as `AAPL`.

## Included contracts

- `contracts/engines/PricingOracle.sol`: quotes premiums from spot price, volatility, duration, and vault utilization.
- `contracts/core/InsuranceVault.sol`: accepts LP deposits, locks reserves, receives premiums, and pays claims.
- `contracts/core/PolicyFactory.sol`: creates policies and settles them after expiry.
- `contracts/mocks/MockPriceFeed.sol`: local mock feed for spot price and volatility.
- `contracts/mocks/StockHedgeDemoDeployer.sol`: deploys a ready-to-test AAPL demo stack.

## Quick demo path

1. Open Remix and compile `contracts/mocks/StockHedgeDemoDeployer.sol` with Solidity `0.8.20+`.
2. Deploy `StockHedgeDemoDeployer` with your wallet address as `finalOwner`.
3. Read the deployed child addresses:
   - `pricingOracle()`
   - `insuranceVault()`
   - `policyFactory()`
4. Open `frontend/index.html` in a browser with MetaMask.
5. Paste the three addresses into the page and connect your wallet.
6. Deposit some ETH into the vault as LP, then quote and buy a policy.
7. After expiry, update the mock spot price in `aaplSpotFeed` from Remix and settle the policy.

## Demo defaults

- Symbol: `AAPL`
- Spot price: `185 USD`
- Volatility feed: `28.00%`
- Market-hours enforcement: disabled in the demo deployer so you can test anytime
- Coverage cap per policy: `50 ETH`

## Important assumptions

- Policies settle against the current oracle price when `settlePolicy` is called.
- Coverage and payouts are denominated in the chain native token for simplicity.
- The volatility feed is expressed in basis points-like percent terms for pricing, not as a full options model.
- This is an educational MVP, not production-ready insurance infrastructure.
