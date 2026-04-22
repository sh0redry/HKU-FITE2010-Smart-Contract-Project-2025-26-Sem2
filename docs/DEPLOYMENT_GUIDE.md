# Deployment Guide

## Environments

The repository now supports three environment styles:

- `local`
  Hardhat localhost with seeded test users and liquidity.
- `demo`
  Local demo deployment with lighter seeded liquidity and relaxed showcase assumptions where needed.
- `testnet`
  Real RPC-backed testnet deployment using environment variables.

## Environment Variables

Create a local `.env` from `.env.example` and provide:

- `SEPOLIA_RPC_URL`
- `BASE_SEPOLIA_RPC_URL`
- `DEPLOYER_PRIVATE_KEY`

## Commands

### Compile

```bash
npm run compile
```

### Full Test Matrix

```bash
npm run test
npm run test:unit
npm run test:integration
npm run test:fuzz
npm run test:stress
```

### Local Node

```bash
npm run node
```

### Local Deployment

```bash
npm run deploy:local
```

Output file:

- `frontend/deployments/localhost.json`

### Demo Deployment

```bash
npm run deploy:demo
```

Output file:

- `frontend/deployments/demo.json`

### Sepolia Deployment

```bash
npm run deploy:sepolia
```

Output file:

- `frontend/deployments/sepolia.json`

### Base Sepolia Deployment

```bash
npm run deploy:base-sepolia
```

Output file:

- `frontend/deployments/base-sepolia.json`

## Frontend Files

The buyer and admin frontends auto-detect the chain and then try to read a matching deployment file:

- `localhost.json`
- `sepolia.json`
- `base-sepolia.json`

If you deploy to a real testnet, either:

- write the file directly with the deploy script output, or
- copy from the corresponding example file and paste real addresses.

## Recommended Deployment Sequence

1. Run the full test matrix.
2. Run `npm run gas:report`.
3. Deploy to the chosen environment.
4. Open:
   - `frontend/index.html`
   - `frontend/admin.html`
5. Verify:
   - supported markets
   - governance roles
   - seeded liquidity
   - revert decoding on a known failing action

## Pre-Demo Checklist

- Confirm correct `pricingOracle`, `policyFactory`, and `insuranceVault` addresses.
- Confirm role addresses for:
  - governor
  - riskManager
  - oracleManager
  - pauser
- Confirm market-hours enforcement for both U.S. and Hong Kong symbols.
- Confirm policy purchase, settlement, and LP deposit/withdraw all succeed on the target environment.
