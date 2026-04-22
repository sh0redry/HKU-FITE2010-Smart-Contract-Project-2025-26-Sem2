# Defense Brief

## 1. Problem Statement

This project builds an on-chain stock hedge insurance protocol. A buyer pays a premium to insure against a defined upward or downward move in a stock price over a chosen duration. A liquidity pool underwrites the risk and receives premiums unless the insured event triggers a payout.

## 2. Why This Design

The design intentionally separates:

- asset custody and LP accounting
- policy lifecycle logic
- pricing logic
- oracle integration
- governance and incident response

This separation makes the protocol easier to test, explain, and extend.

## 3. Core Product Scope

- U.S. stocks:
  - `AAPL`
  - `TSLA`
  - `NVDA`
  - `MSFT`
- Hong Kong stocks:
  - `0700HK`
  - `9988HK`
  - `0005HK`
- Directional products:
  - downside protection
  - upside protection
- Trigger band:
  - `5%` to `20%`

## 4. Key Technical Decisions

### Off-chain risk inputs, on-chain lightweight pricing

Complex market estimation is expensive on-chain. The protocol therefore keeps the final premium formula on-chain but receives richer risk inputs from a separate provider interface.

### Oracle adapter abstraction

The pricing contract never reads raw feeds directly. This protects the architecture from tight coupling to one feed format and makes fallback strategies explicit.

### Governance role separation

Instead of one admin wallet doing everything, the system separates:

- governor
- risk manager
- oracle manager
- pauser

This matches real operational practice and improves security posture.

### Multi-market session coverage

The protocol supports both U.S. and Hong Kong equities, so the demo can cover more of the day without opening policies during closed exchange windows.

## 5. Risk Controls

- symbol exposure limits
- direction exposure limits
- term-bucket limits
- utilization-based gating
- liquidity-buffer solvency check
- market-hours enforcement
- close-buffer opening restrictions
- fallback oracle controls
- pause mechanisms

## 6. Frontend Story

There are three user-facing surfaces:

- `frontend/index.html`
  buyer and LP operations
- `frontend/admin.html`
  monitoring and governance
- `frontend/simulation.html`
  scenario analysis and replay

The buyer frontend now provides:

- network-aware deployment loading
- readable custom revert errors
- policy status grouping
- LP metrics
- risk and pricing charts

## 7. Testing Strategy

The project now includes:

- lifecycle regression tests
- unit tests
- integration tests
- fuzz-style randomized tests
- extreme market stress tests

This is important in the defense because it shows the system was tested from both correctness and resilience angles.

## 8. Remaining Gaps

- no full exchange-holiday dataset
- no Hong Kong lunch-break session split yet
- no production secrets or live RPC keys in repo
- no external audit

## 9. Recommended Demo Script

1. Show buyer page and quote a U.S. policy.
2. Show that buying is blocked outside market hours.
3. Switch to a Hong Kong ticker and show staggered market coverage.
4. Show admin page risk limits and pause controls.
5. Show LP dashboard metrics.
6. Show scenario simulator for batch underwriting outcomes.

## 10. One-Sentence Summary

This project is a modular on-chain stock hedge insurance MVP that combines directional policy products, oracle abstraction, LP underwriting, multi-market session controls, and governance-aware risk management in a testable architecture.
