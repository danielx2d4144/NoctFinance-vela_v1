# 27. Performance Model

**Status:** Engineering baseline; benchmark values remain conditional  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## No official TPS guarantee

The reviewed Vela repositories do not provide a production TPS or time-to-finality guarantee for Noct's workload. Values in this file are capacity-planning ranges, not promises. File 28 benchmarks the pinned deployment and replaces estimates with measured p50/p95/p99/max results.

## Actual request path

```text
client encode, key derivation, P-521 encryption
→ RPC transit
→ ProcessorEndpoint transaction inclusion
→ Manager polling and pickup
→ Executor state/payload decryption
→ TinyGo WASM decode, accrual, risk/accounting logic
→ state/result serialization and encryption
→ signed ProcessorEndpoint.stateUpdate inclusion
→ optional trigger execution and TRUSTPROCESS round trip
→ optional native claim delivery
```

Custom UltraHonk proving/zkVerify, when enabled, is an additional Noct path before or between these stages; it is not native Vela execution.

## Planning ranges before benchmarking

| Stage | Initial engineering range | Primary variables |
|---|---:|---|
| Client encoding and P-521 encryption | 2–30 ms | device, payload size, key caching |
| RPC/network transit | 50–500 ms | region, provider, congestion |
| Request transaction inclusion | one or more blocks | deployment chain |
| Manager pickup | 0.1–5 s | polling, queue depth |
| TEE decrypt/authenticate | 1–10 ms | payload/state size |
| Lending WASM execution | 1–100 ms | account lookup, U256 math, scan work |
| Full state serialization/encryption | 1–1000+ ms | serialized-state growth |
| Signed state-update inclusion | one or more blocks | chain congestion and gas |
| Custom UltraHonk proof | target 8–30+ s; unverified | circuit, hardware, queue |
| zkVerify receipt/finality | seconds to minutes | external chain/service |
| Trigger plus TRUSTPROCESS | at least one additional Vela round trip | trigger, queue, blocks |
| User `claim()` delivery | one additional user transaction | optional timing |

Nitro cryptography and basic U256 arithmetic are unlikely to dominate. Blockchain inclusion, Manager queue/polling, whole-state processing, custom proving, and trigger round trips are expected bottlenecks.

## Operation paths and provisional latency

These ranges assume a responsive fast EVM-like development/test deployment. They exclude optional custom proving unless stated. Twelve Ethereum-style confirmations or another conservative finality policy can add minutes per custody-sensitive phase.

| Operation | Required Vela phases | Fast-chain planning range | Conservative-finality effect |
|---|---:|---:|---:|
| Consume deposit | finalized receipt + one processing/state update | 10–45 s after receipt finality | deposit finality commonly dominates; roughly 3–5+ min |
| Supply | one PROCESS/state update | 5–30 s | one configured finality window |
| Release collateral | PROCESS intent + oracle TRUSTPROCESS | 15–60 s | two state-update cycles |
| Borrow | PROCESS intent + oracle TRUSTPROCESS | 15–60 s | two cycles; add proof time if mandatory |
| Withdraw cash/borrowed asset | one PROCESS/state update | 5–30 s to claim availability | user claim is an extra transaction |
| Prepare repay | one PROCESS/state update | 5–30 s | one cycle |
| Capture and commit repay | payment finality + TRUSTPROCESS/state update | 20–90 s after payment submission | can reach several minutes |
| Discover/prepare liquidation | PROCESS + oracle TRUSTPROCESS + bounded scan | 20–90 s | two cycles plus queue/scan |
| Capture and commit liquidation | payment finality + TRUSTPROCESS with withdrawal | 20–90 s | can reach several minutes |
| Full liquidation from discovery | four or more chain-coordinated phases | 60–180+ s fast chain | approximately 5–10+ min under conservative finality |

A 10–20 second borrow or 45–60 second full liquidation is not a frozen guarantee. It is only achievable if block times, queues, proving policy, and trigger phases support it in measured tests.

## Time-to-finality definitions

Metrics MUST distinguish:

- `requestIncluded`: initial transaction is canonical under configured policy;
- `privateStateFinal`: corresponding Vela state update is canonical;
- `claimAvailable`: pending claim exists and private debit is final;
- `walletDelivered`: recipient has called `claim()` and token transfer finalized;
- `paymentCaptured`: repayment/liquidation receipt is canonical;
- `economicCommitFinal`: captured receipt is consumed and debt/collateral update is canonical.

Reporting one ambiguous “transaction latency” is prohibited.

## Throughput constraints

V1 has one global encrypted application state and one Noct `appRoot`. State updates are ordered against prior roots. Global-root-bound custom proofs become stale whenever another transition commits. Therefore, V1 cannot assume arbitrary parallel mutation merely because Nitro Enclaves have multiple vCPUs.

Before measurement, capacity planning SHOULD use a conservative single-application range of:

```text
0.2–2 finalized Noct transitions per second
```

This is not a guarantee. If mandatory proof generation takes 8–15 seconds and every proof binds the current monolithic root, serialized proof throughput can fall near:

```text
0.07–0.125 transitions per second per sequential proof path
```

Parallel provers help only when work can be batched or proofs do not become stale on unrelated root changes. Sharding, batching, and concurrent-root semantics require a future state/proof version.

## State-size risk

If Vela decrypts, passes, serializes, encrypts, and hashes the full application state per request, latency and memory grow with:

- number of accounts;
- pending and historical operations;
- consumed receipt retention;
- compliance history;
- Merkle structure representation.

Noct MUST benchmark at realistic state sizes, not only an empty ledger. Append-only replay/compliance data may use authenticated compact accumulators and externally retained encrypted report data only if the pinned Vela and commitment design preserve complete auditability and recovery. Pruning without a proven retention model is prohibited.

## Liquidation scan budget

Private discovery uses a deterministic bounded work budget and at most one opaque quote per request. Benchmark:

- accounts checked per request;
- worst-case U256/risk computation cost;
- cursor persistence;
- timing leakage buckets;
- starvation time to inspect the full active-debt set.

A fixed 30-second discovery SLA is unsupported until measured under maximum target account count and concurrent traffic.

## Availability and backpressure

The Manager/prover/reconciliation services MUST expose queue depth and oldest-item age. When capacity is exceeded:

- reject or defer before payment capture where safe;
- do not accept unlimited prepared operations;
- prioritize captured-payment commits and custody reconciliation;
- prioritize oracle updates/risk-critical work according to documented policy;
- never drop a captured receipt or committed withdrawal result.

## Required metrics

For each operation and phase record p50, p95, p99, max, success rate, retry count, queue time, CPU, memory, state size, encrypted payload/result size, gas, block inclusion delay, and reorg/finality delay.

For custom proofs also record circuit constraints, witness time, proof time, proof size, verifier time, receipt delay, stale-proof rate, and regeneration count.

## Release gates

Published latency/TPS claims require:

1. a pinned Vela/Noct/chain configuration;
2. realistic account/history/receipt state sizes;
3. at least one sustained-load and burst test;
4. restart/reorg/trigger-failure injection;
5. p95 and p99 results, not averages alone;
6. separate claim-availability and wallet-delivery metrics;
7. no custody, scaled-debt, replay, or state-root invariant failure.
