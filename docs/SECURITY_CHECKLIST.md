# Security Checklist

## Reentrancy

- `InsuranceVault.deposit` and `InsuranceVault.withdraw` are guarded by `nonReentrant`.
- `InsuranceVault.payClaim` is also guarded by `nonReentrant`.
- `PolicyFactory` does not transfer ERC20 assets directly; it routes asset movement through `InsuranceVault`.
- Review item:
  Confirm future ERC20 upgrades do not introduce callback behavior that bypasses the current assumptions.

## Access Control And Privilege Separation

- `PricingOracle` uses OpenZeppelin `AccessControl` with:
  - `GOVERNOR_ROLE`
  - `RISK_MANAGER_ROLE`
  - `ORACLE_MANAGER_ROLE`
  - `PAUSER_ROLE`
- `PolicyFactory` uses OpenZeppelin `AccessControl` with:
  - `GOVERNOR_ROLE`
  - `RISK_MANAGER_ROLE`
  - `PAUSER_ROLE`
- `InsuranceVault`, `MockUSDC`, `MockRiskParameterProvider`, and `ChainlinkOracleAdapter` use OpenZeppelin `Ownable`.
- Review item:
  Ensure testnet and production deployments do not leave all privileged roles on a single EOA.

## Oracle Manipulation And Staleness

- Spot data is accessed through `IOracleAdapter`, not raw feeds.
- `ChainlinkOracleAdapter` validates:
  - positive answer
  - nonzero `updatedAt`
  - freshness via `maxStaleness`
  - `answeredInRound >= roundId`
- `PricingOracle` can reject fallback use per market.
- Review item:
  For production, use independent primary/fallback sources and set market-specific `maxStaleness`.

## Market Hours And Settlement Controls

- New policy opening is blocked when the market is closed if `enforceMarketHours` is enabled.
- Close-buffer logic blocks opening too close to session end.
- `SettlementPricePending` blocks settlement before the allowed settlement window.
- Review item:
  Hong Kong lunch break is not yet modeled. Current implementation uses a simplified continuous local session.

## Solvency And Accounting

- `PolicyFactory` checks:
  - post-trade utilization cap
  - minimum liquidity buffer
  - per-symbol exposure cap
  - direction exposure cap
  - term bucket exposure cap
  - current `availableLiquidity`
- `InsuranceVault` maintains:
  - `totalAssets`
  - `totalReserved`
  - `realizedPremiums`
  - `totalClaimsPaid`
- Review item:
  Confirm that future fee-routing logic preserves the invariant `availableLiquidity = totalAssets - totalReserved`.

## Precision And Decimal Handling

- Oracle prices are normalized to 18 decimals.
- Settlement token accounting uses 6-decimal `MockUSDC`.
- Spot values and token values are kept separate.
- Review item:
  If migrating to real USDC, preserve 6-decimal assumptions in frontend formatting and deployment scripts.

## Pause And Incident Response

- `PAUSER_ROLE` can pause quoting and underwriting.
- `GOVERNOR_ROLE` can unpause.
- Review item:
  Maintain an incident runbook listing who is authorized to pause which contracts and in what order.

## Test Coverage Expectations

- Unit tests cover vault and pricing-edge behaviors.
- Integration tests cover end-to-end multi-policy flow.
- Fuzz tests cover randomized quote/purchase invariants.
- Stress tests cover extreme price shocks.
- Review item:
  Before public testnet demos, rerun all categories and archive the results with commit hash and deployment addresses.
