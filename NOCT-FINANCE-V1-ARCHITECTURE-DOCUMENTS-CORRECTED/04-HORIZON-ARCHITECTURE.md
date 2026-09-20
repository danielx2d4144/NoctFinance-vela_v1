# 4. Horizon Architecture

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.


## Role

Horizon is the public blockchain/settlement boundary. It MUST NOT become a plaintext database of user lending positions.

## Public layer

Publicly visible data may include:
- application identity;
- state commitments;
- proof/receipt references;
- configuration identifiers;
- aggregate protocol statistics;
- external settlement transactions.

## Private layer

Private data includes:
- user cash;
- user collateral;
- debt;
- borrowed balance;
- LTV;
- health factor;
- user-specific history.

## Custody flow

```text
User wallet
   ↓
Vela ProcessorEndpoint / application funds
   ↓
Noct private accounting
```

For a normal USDC withdrawal:

```text
private cashUSDC
   ↓
authorized withdrawal
   ↓
Vela settlement
   ↓
Horizon
   ↓
wallet
```

## Important limitation

A public blockchain transfer can expose recipient and amount. Noct therefore claims private lending state, not absolute blockchain anonymity.

## Developer rule

Never emit user position values from Solidity or public application events.
