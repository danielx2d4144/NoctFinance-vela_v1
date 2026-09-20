# 28. Benchmarking Plan

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## Goal

Measure the pinned end-to-end Vela deployment before making latency, TPS, finality, browser-proving, or liquidation-SLA claims. Benchmarks must preserve all security checks and use the corrected scaled-debt, oracle, receipt, and settlement paths.

## Reproducible environment record

Every report MUST include:

- Vela Starterkit/core/Nova commits and contract addresses;
- Noct WASM, trigger, OracleAdapter, escrow, circuit, and verifier commits;
- Go/TinyGo/Node/Noir/Barretenberg/zkVerify versions;
- AWS Nitro instance/enclave CPU and memory allocation;
- Manager/Executor regions and polling configuration;
- RPC providers, chain ID, block time, finality policy, and gas policy;
- Pyth contract, SDK version, feed IDs, and update source;
- client hardware/browser;
- account, pending-operation, receipt, history, and serialized-state sizes.

## Harness

```text
benchmark/
  client-crypto/
  vela-request/
  wasm/
  state-size/
  oracle-adapter/
  trigger-trustprocess/
  settlement/
  liquidation-scan/
  circuits/
  prover/
  zkverify/
  recovery/
  reports/
```

The harness MUST use public APIs and official Vela request paths. It MUST NOT benchmark a direct-to-enclave shortcut unavailable to users.

## Operation matrix

| Operation | PROCESS | Oracle TRUSTPROCESS | Payment receipt | Native withdrawal | Optional ZK |
|---|---:|---:|---:|---:|---:|
| Consume deposit | ✓ | — | deposit receipt | — | conditional |
| Supply | ✓ | — | — | — | conditional |
| Release collateral | ✓ | ✓ | — | — | conditional |
| Borrow | ✓ | ✓ | — | separate T06 | conditional |
| Withdraw cash/borrowed asset | ✓ | — | — | ✓ | conditional |
| Prepare repay | ✓ | — | — | — | conditional |
| Capture/commit repay | — | ✓ | ✓ | — | conditional |
| Discover/prepare liquidation | ✓ | ✓ | — | — | conditional |
| Capture/commit liquidation | — | ✓ | ✓ | USDC ✓ | conditional |
| Deanonymization report | DEANONYMIZATION | — | — | — | — |

## Phase timing

Record monotonic timestamps for:

1. client command construction;
2. optional witness/proof queue, generation, verification, and authorization;
3. P-521 encryption;
4. RPC submission;
5. request transaction inclusion/finality;
6. Manager pickup;
7. Executor decrypt;
8. WASM decode and validation;
9. reserve accrual/risk/accounting execution;
10. commitment/Merkle update;
11. state/result serialization and encryption;
12. signed state-update submission/inclusion/finality;
13. trigger `_execute` and trusted-payload generation;
14. TRUSTPROCESS queue/pickup/state update;
15. payment transaction inclusion/finality;
16. pending-claim availability;
17. user claim submission and wallet delivery.

Do not combine claim availability with wallet delivery or payment capture with economic commit.

## Load profiles

For every operation run:

- single request cold and warm;
- sustained 1, 5, 10, 25, and 50 submitted requests/second until saturation;
- bursts of 10, 100, and 1,000 requests;
- one-account contention;
- many-account contention against one global root;
- mixed workload representative of expected production;
- priority load with captured commits competing against new requests.

Report achieved finalized TPS, rejected/deferred rate, queue growth, stale-root/proof rate, and time to drain after the load ends.

## State-size matrix

At minimum benchmark:

| Accounts | Active debt accounts | History/receipts | Pending operations |
|---:|---:|---:|---:|
| 100 | 10 | 1,000 | 10 |
| 10,000 | 1,000 | 100,000 | 100 |
| 100,000 | 10,000 | 1,000,000 | 1,000 |

If the largest tier cannot fit enclave memory or service targets, report the limit and redesign before claiming that capacity. Measure serialized/encrypted state size and per-request full-state copy/hash cost.

## Arithmetic and accounting benchmarks

Benchmark checked U256 operations independently and inside WASM:

- canonical decode/encode;
- `mulDivDown` and `mulDivUp` near U256 limits;
- kink-rate calculation;
- bounded chunked index accrual;
- account/reserve debt derivation;
- health/LTV calculation;
- liquidation cross-asset valuation;
- commitment-tree updates.

Performance tests MUST run the same overflow, rounding, and invariant checks as production. Native integers or floating point are not valid benchmark substitutes.

## Oracle benchmark

Measure:

- Pyth update-data acquisition separately from protocol latency;
- `OracleAdapter` gas and execution for all three exact feeds;
- parse/verification failure cases;
- exponent/confidence/deviation validation;
- adapter-to-trigger delay;
- on-chain `maxRiskDelaySeconds` rejection boundary;
- trigger-to-TRUSTPROCESS latency;
- duplicate/equal/older epoch rejection.

Inject stale, future, high-confidence-width, missing-feed, wrong-feed, negative-price, exponent-overflow, and breaker conditions.

## Repayment/liquidation benchmark

Measure PREPARE, payment CAPTURE, and COMMIT separately. Include:

- payment finality;
- receipt creation and authenticated delivery;
- commit queue priority;
- commit retries after Manager/Executor/trigger/RPC failure;
- lost acknowledgement;
- duplicate receipt/commit delivery;
- pre-capture expiry;
- long post-capture delay with no expiry/refund;
- liquidation scan work budget and full-set starvation time.

A liquidation SLA includes discovery, prepare, payment, commit, claim availability, and optionally wallet delivery; state which endpoint is measured.

## Custom ZK benchmark

ZK is conditional until measured. Record:

- constraints and witness size;
- witness/proof p50/p95/p99/max;
- CPU/RAM and device thermals;
- proof size;
- direct verifier and zkVerify receipt time;
- queue delay and failure rate;
- stale global-root proof rate under concurrent traffic;
- regeneration cost;
- total public-input count and schema version.

Compare browser, mobile, dedicated prover, and no-ZK Vela paths. Do not make browser proving mandatory unless target-device p95 and failure rate satisfy an explicitly approved product threshold.

## Recovery and chaos tests

Inject:

- client/facilitator/RPC disconnects;
- Manager/Executor restart at every lifecycle phase;
- unsupported one-component restart;
- chain reorgs before configured finality;
- corrupted or missing encrypted-state versions;
- OracleAdapter and Pyth outage;
- trigger revert;
- payment captured with commit delayed;
- unclaimed pending withdrawal;
- custody/app-root/scaled-debt mismatch.

Measure recovery time but require fail-closed correctness first. No test may repair state by manufacturing receipts or replaying deposits into an empty ledger.

## Statistics

For every phase and end-to-end definition record:

- p50, p95, p99, max;
- confidence interval and sample count;
- throughput and queue depth;
- success/retry/rejection rate;
- CPU, memory, network, disk, and gas;
- state/proof/payload sizes;
- invariant failures, which must be zero.

Averages alone are insufficient. Warm-up, outlier policy, clock source, and raw anonymized results MUST be retained.

## Go/no-go gates

A path passes only when:

1. custody, scaled-debt, receipt, replay, oracle, and state-root invariants never fail;
2. captured payments always reach idempotent commit under recovery drills;
3. no duplicate withdrawal or receipt effect occurs;
4. p95/p99 latency meets an approved operation-specific target;
5. sustained load reaches the approved TPS without unbounded queue growth;
6. maximum target state fits enclave memory with headroom;
7. timing/log/event leakage remains within File 24 policy;
8. results are reproducible from the pinned environment record.

Until these gates pass, File 27 ranges remain planning estimates and MUST NOT be marketed as measured performance.
