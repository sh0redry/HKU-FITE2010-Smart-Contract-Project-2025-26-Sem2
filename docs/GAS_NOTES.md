# Gas Notes

## Implemented Optimizations

The current codebase includes several low-risk gas improvements that do not change business behavior:

- cached array lengths in loop-heavy paths
- `unchecked` loop increments where bounds are already controlled
- reduced redundant storage reads in active-policy removal

These changes were applied primarily in:

- `contracts/core/PolicyFactory.sol`
- `contracts/automation/PolicySettlementAutomation.sol`

## Why These Paths

The most gas-sensitive flows in this project are:

- policy purchase
- policy settlement
- keeper-based batch settlement
- active-policy pagination

These are called frequently enough that small loop and storage optimizations are worthwhile.

## Measurement Approach

Use:

```bash
npm run gas:report
```

This reports estimated gas for:

- `purchasePolicy`
- `deposit`
- `withdraw`

## Future Gas Work

- tighter packing for policy metadata if product fields stabilize
- separate storage for immutable quote metadata vs mutable lifecycle fields
- batch settlement pagination tuned against expected active-policy counts
- optional event simplification if logs become a major cost driver on testnet
