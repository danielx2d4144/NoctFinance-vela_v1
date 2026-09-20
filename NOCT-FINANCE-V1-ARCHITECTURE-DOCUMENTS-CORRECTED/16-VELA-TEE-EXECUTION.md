# 16. Vela TEE Execution

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## Execution model

Noct uses the official Vela v0.2.0 model:

- `ProcessorEndpoint` queues requests and verifies signed state updates;
- the Secure Processor Manager runs outside the enclave and coordinates chain, storage and Executor access;
- the Wasmtime-go Executor runs in the intended AWS Nitro Enclave environment;
- Noct is a TinyGo/WASI guest;
- application state is AES-256 encrypted and versioned outside the guest;
- private payloads and user events use the TEE's P-521 communication key;
- state updates use the attested TEE secp256k1 signing key.

The deployed implementation MUST pin one Vela release and commit. Official ABI and guest types from that pin are normative.

## Standard PROCESS execution

```text
client builds request bound to chain, ProcessorEndpoint and Noct appId
  ↓
official Vela P-521 encryption of private payload
  ↓
ProcessorEndpoint.submitRequest(..., appId, PROCESS, encryptedPayload, ...)
  ↓
Manager dequeues request and loads encrypted versioned state + WASM
  ↓
Executor decrypts state and PROCESS payload
  ↓
Noct process_request(appId, sender, requestType, payload, state)
  ↓
Noct computes complete next state and ProcessResult
  ↓
Executor encrypts state/events, computes root and signs UpdatePayload
  ↓
Manager submits ProcessorEndpoint.stateUpdate
  ↓
ProcessorEndpoint verifies the TEE signature and finalizes effects
```

The `appId` parameter MUST equal the application ID stored in Noct state. A mismatch is fatal. The application MUST also bind user authorization and custom proof inputs to chain ID, `ProcessorEndpoint`, `appId`, protocol/config version, state commitment, transition, nonce and expiry as specified by the authorization architecture.

P-521 encryption provides confidentiality and recipient binding for Vela payloads, events and deanonymization reports. It does not prove a Pyth price, replace `ProcessorEndpoint`'s TEE signature check, or make public `AppEvent` data private.

## TRUSTPROCESS execution

Noct exports the official optional trigger entry point:

```go
//export trusted_request
func trusted_request(appId int64, payloadPtr *byte, payloadLen int32,
    statePtr *byte, stateLen int32) *byte
```

A user cannot submit `TRUSTPROCESS` through `submitRequest`. A trigger registered by `submitDeployRequestWithTrigger` is invoked by `ProcessorEndpoint` during `stateUpdate`; its nonempty `getTrustProcessPayload` result is put in the higher-priority trigger queue. The Manager and Executor route it to `trusted_request`.

The trusted payload is clear text and is not P-521-decrypted. This is safe only because the endpoint created it through the registered trigger route. `trusted_request` receives no sender and no request type, so Noct MUST authenticate by validating the payload's configured domain:

```text
protocolDomain
chainId
ProcessorEndpoint address
Noct appId
deployed NoctTrigger address
OracleAdapter address
payloadKind
operationId
```

The guest MUST compare `appId` both to persisted state and the payload domain, reject noncanonical ABI data, enforce operation replay state, and return no mutation on any mismatch. Payload data must still be treated as public: it MUST contain no account address, balance, health factor or other private position data.

## Frozen oracle acceptance in the guest

The OracleAdapter/trigger payload carries:

```text
epoch
adapterBlockNumber
adapterBlockTimestamp
triggerBlockNumber
triggerBlockTimestamp
configured feed IDs
normalized prices and confidence values
Pyth publish times
snapshotCommitment
bound operationId and operation kind
```

`trusted_request` MUST:

1. validate the configured trigger domain described above;
2. recompute the snapshot commitment exactly;
3. require `epoch > OracleState.epoch`;
4. require nondecreasing adapter block number and adapter block timestamp;
5. require nondecreasing per-feed Pyth publish times;
6. require the trigger observation not to precede the adapter block data;
7. require the operation ID to be pending, unconsumed and bound to the payload kind;
8. store the new `OracleState` and execute the coupled risk operation in one atomic guest transition.

The guest MUST NOT verify a made-up 65-byte "Pyth signature." Pyth verification occurs only through the official on-chain Pyth EVM contract called by `OracleAdapter`. The guest MUST NOT obtain prices over HTTP, trust a facilitator snapshot, call `time.Now`, use WASI clock time, or claim it can independently establish freshness. On-chain `NoctTrigger` enforces the maximum adapter delay against EVM `block.timestamp` before producing the trusted payload.

A risk-sensitive operation MUST use the oracle epoch accepted by that same `trusted_request`; it cannot select an older stored epoch. Reserve interest is accrued to `adapterBlockTimestamp`. Pyth `publishTime` is for source-price validation and monotonicity, not the protocol interest clock.

## Risk intent staging

Because a normal `process_request` runs before the on-chain trigger reads the adapter, it cannot safely finalize risk state. For borrow, collateral release and liquidation preparation:

1. `process_request` validates user authorization and creates an opaque, deterministic pending intent;
2. it emits only a domain-separated `AppEvent` containing the opaque operation ID and operation kind;
3. no debt, collateral, reserve or oracle state changes yet;
4. the registered `AbstractTrigger` reads `OracleAdapter`, checks on-chain delay, and returns the bound payload;
5. `trusted_request` accepts the newer epoch and either atomically executes the intent or marks it failed without financial mutation.

Pending intents require bounded expiry and idempotent replay behavior. An error before trusted execution releases no funds and changes no financial state.

## Thin bridge

`main.go` is limited to:

- WASM pointer and byte conversion;
- conversion through pinned `vela-common-go` types;
- dispatch to `Deploy`, `LoadModule`, `Deposit`, `ProcessRequest` or `TrustedRequest`;
- result serialization.

All financial validation, checked U256 arithmetic, oracle commitment logic, operation locks and compliance reporting belong in `app/`.

## Determinism and atomicity

Noct guest logic MUST NOT rely on arbitrary network access, random execution, local clocks, floating point, `math/big`, mutable globals or map iteration order. Identifiers derive deterministically from domain-separated state counters and request data. Every handler computes and validates the complete state/result pair before returning it.

`trusted_request` SHOULD emit zero `AppEvent`s so the trigger returns an empty follow-up payload and terminates. Any deliberate trigger chain MUST persist a strictly bounded step count and prove termination.

## Custom ZK boundary

Noct proof workers, Noir/UltraHonk circuits and zkVerify receipts are application-specific. The Executor does not natively generate or verify these proofs. The guest verifies only the custom authorization artifact defined by Noct, while Vela supplies TEE execution and attested state updates. Code, diagrams and threat claims MUST keep those trust domains distinct.

## DEANONYMIZATION execution

For official Vela request type `DEANONYMIZATION` (`requestType = 2`), the Executor decrypts the authorized request and calls `process_request`. Noct MUST return a nonempty `ProcessResult.Report` and MUST NOT place the report in a `PlainEvent`, `AppEvent`, log or trigger payload. The Executor encrypts the report to the authorized authority's P-521 key; the Manager stores it for authenticated Authority Service retrieval. The report path is gated by `AuthorityRegistry` and is separate from normal user and liquidation access.