# Security Overview

This project is a course-grade Solidity MVP for stock hedge insurance. It is designed to demonstrate secure smart contract architecture, not to hold real funds in production without a professional audit.

## Main Protections

- `InsuranceVault` uses OpenZeppelin `Ownable`, `ReentrancyGuard`, and `SafeERC20`.
- `PolicyFactory` uses OpenZeppelin `AccessControl`, `Pausable`, and `ReentrancyGuard`.
- `PricingOracle` uses role-based access control and pausable quoting.
- Settlement assets are held in the vault; policy lifecycle logic is separated from asset custody.
- Oracle access goes through `IOracleAdapter` instead of direct raw feed reads.
- `ChainlinkOracleAdapter` rejects stale, zero, negative, future-timestamped, and incomplete feed rounds.
- Risk limits include utilization caps, minimum liquidity buffer, per-symbol exposure caps, direction caps, and term-bucket caps.
- Unknown policy IDs fail with `InvalidPolicyId(policyId)`.
- Batch settlement skips invalid or not-yet-settleable IDs to avoid keeper batch failure.

## Known Limitations

- Local demos use `MockUSDC`, mock price feeds, and a yfinance-backed development proxy.
- The pricing model is a lightweight risk model, not a production Black-Scholes implementation.
- Real stock insurance would require regulatory, oracle, and market-data licensing review.
- Testnet deployments should not be treated as production deployments.

## Recommended Pre-Submission Checks

```bash
npm install
npm run compile
npm test
```

Expected result at the time of writing:

```text
40 passing
```

For a detailed audit checklist, see [docs/SECURITY_CHECKLIST.md](docs/SECURITY_CHECKLIST.md).
