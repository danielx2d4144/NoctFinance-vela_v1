# 8. NoctState V1

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## Logical state

```text
NoctStateV1
├── GlobalState
├── ReserveState[ZEN, ETH]
├── OracleState
├── ProtocolConfig
├── CommitmentState
├── PrivateAccountState
├── PendingOperationState
└── ReceiptState
```

Every persisted state object MUST have one canonical serialization. Financial values and indexes are encoded as exactly 32 unsigned big-endian bytes. Encodings with another width, a sign byte, leading data, or a value outside `0..2^256-1` MUST be rejected rather than normalized.

## Numeric types and units

| Type | Unit | Use |
|---|---|---|
| `AmountWad` | WAD (`10^18`) | USDC, ZEN and ETH token amounts |
| `PriceWad` | WAD (`10^18`) | USD price per whole token |
| `RatioWad` | WAD (`10^18`) | LTV, liquidation threshold, bonus and close factor |
| `RateRay` | RAY (`10^27`) | annual borrow rates and utilization |
| `IndexRay` | RAY (`10^27`) | reserve borrow indexes |
| `ScaledDebt` | RAY-scaled debt shares | account and reserve scaled debt |

All table entries above are U256 values on the wire and in persistent state. `uint64` is permitted only for non-financial counters and time metadata such as nonce, version, epoch and Unix timestamp.

The Go implementation MUST use an audited, TinyGo-compatible, checked U256 implementation with full-width `mulDivDown` and `mulDivUp`. Financial code MUST NOT use Go `uint64`, `int`, `float32`, `float64`, `math/big`, unchecked multiplication, or a TinyGo overflow panic as an arithmetic policy. Every add, subtract, conversion and multiplication MUST return and handle overflow or underflow explicitly.

## Private account

```text
PrivateAccount {
    address                  [20]byte
    cashUSDC                 AmountWad
    collateralUSDC           AmountWad
    borrowedZEN              AmountWad
    borrowedETH              AmountWad
    scaledDebtZEN            ScaledDebt
    scaledDebtETH            ScaledDebt
    positionNonce            uint64
    lastUpdateTimestamp      uint64
}
```

`borrowedZEN` and `borrowedETH` are private balances still held in Vela custody. They are not historical amounts withdrawn to a wallet. A native withdrawal debits the corresponding balance and emits a Vela withdrawal in the same successful transition.

There is no principal or entry-index field in V1. For asset `a`:

```text
accountDebt(a) = mulDivUp(account.scaledDebt[a], reserve.borrowIndex[a], RAY)
totalDebt(a)   = mulDivUp(reserve.totalScaledDebt[a], reserve.borrowIndex[a], RAY)
```

Rounding debt upward prevents a borrower from escaping a fractional obligation. The reserve aggregate MUST be derived from `totalScaledDebt`; it MUST NOT be maintained as a separately rounded sum of account debts.

## Reserve state

```text
ReserveState {
    asset                    ZEN | ETH
    availableLiquidity       AmountWad
    totalScaledDebt          ScaledDebt
    borrowIndex              IndexRay
    lastAccrualTimestamp     uint64
}
```

`borrowIndex` starts at `RAY` and is monotonic. Reserve semantics and custody equations are normative in File 11; accrual is normative in File 19.

## Oracle state interface

```text
OracleState {
    latestAcceptedEpoch      uint64
    latestAcceptedTimestamp  uint64
    usdcPrice                PriceWad
    zenPrice                 PriceWad
    ethPrice                 PriceWad
    oracleCommitment         [32]byte
}
```

Risk-sensitive transitions MUST read the latest accepted authenticated `OracleState` from trusted state. A transaction caller MUST NOT select an older epoch or supply a signature or price snapshot for transition-local verification. Oracle authentication and acceptance are outside this file; this interface only defines what lending logic consumes.

## Pending operations and receipts

```text
PendingOperation {
    operationID              [32]byte
    kind                     REPAY | LIQUIDATION
    status                   PREPARED | PAYMENT_CAPTURED | COMMITTED | EXPIRED
    account                  [20]byte
    asset                    ZEN | ETH
    paymentAmount            AmountWad
    scaledDebtReduction      ScaledDebt
    collateralToWithdraw     AmountWad   // liquidation only
    destination              [20]byte
    oracleEpoch              uint64      // liquidation quote only
    createdAt                uint64
    expiresAt                uint64      // applies only before payment capture
}

InboundReceipt {
    receiptID                [32]byte
    asset                    USDC | ZEN | ETH
    amount                   AmountWad
    purpose                  DEPOSIT | RESERVE_FUNDING | REPAY | LIQUIDATION
    operationID              [32]byte
    status                   PENDING | CAPTURED | CONSUMED
}
```

Receipt identity MUST bind the source chain, custody endpoint, transaction/log identity, asset, amount, sender, purpose and operation ID as applicable. Confirmed receipts enter `PENDING` or `CAPTURED` through the trusted Vela/on-chain integration, never through untrusted user assertions.

Receipt consumption is single-use and atomic with its accounting effect. `CONSUMED` receipt IDs and `COMMITTED` operation IDs are retained in append-only replay-protection state. A repeated commit returns the original successful result and MUST NOT mutate balances or emit another withdrawal.

## Global/public state

```text
GlobalState {
    protocolVersion          uint64
    stateVersion             uint64
    configCommitment         [32]byte
    oracleCommitment         [32]byte
    positionRoot             [32]byte
    stateCommitment          [32]byte
}
```

`stateVersion` increments exactly once for every committed state transition. Account nonces increment exactly once for each accepted user-authorized request; authenticated retry of an already committed operation does not increment it again.

## Derived values — do not store

The following are computed from the current indexes, latest accepted `OracleState`, and committed configuration:

- current account and reserve debt;
- collateral and debt USD values;
- LTV and borrowing capacity;
- liquidation eligibility;
- utilization and current borrow rate.

Pending-operation quote values are stored because they lock an authorized cross-contract operation; they are not alternate sources of current account debt.

## Required state invariants

After every successful transition:

1. `reserve.totalScaledDebt[a] = Σ account.scaledDebt[a]` for each borrow asset.
2. `reserve.borrowIndex[a] >= RAY` and never decreases.
3. No financial subtraction underflows and no U256 operation overflows.
4. Every captured inbound receipt is pending consumption by exactly one purpose, or is already consumed.
5. Every emitted but unsettled withdrawal is represented by Vela's pending outbound accounting.
6. Consumed receipt IDs and committed operation IDs cannot return to an earlier status.
7. `stateVersion`, account nonce, accepted oracle epoch/timestamp, and reserve accrual timestamp are monotonic under their transition rules.
8. The custody conservation equations in File 11 hold for USDC, ZEN and ETH.

A transition that cannot prove all applicable invariants MUST fail without partial state mutation or withdrawal emission.
