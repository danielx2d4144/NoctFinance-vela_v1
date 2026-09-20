# 6. Trust Model

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.


## Trust domains

```text
wallet authorization
      ↓
ProcessorEndpoint request coordination
      ↓
Nitro TEE confidentiality and attestation
      ↓
Noct deterministic state machine
      ↓
Vela stateUpdate, custody and pendingClaims

optional custom branch:
Noct proof → direct verifier or zkVerify authorization
```

## TEE assumptions

Production confidentiality relies on the Nitro Enclave deployment, attestation, enclave measurement and supply-chain integrity. Local Docker execution is not evidence of production enclave security.

## ZK assumptions

Custom ZK is conditional Noct infrastructure, not a native Vela guarantee. When enabled, the proof establishes only its exact versioned transition statement; direct verification or an authenticated zkVerify authorization must be independently implemented and bound as specified in Files 09, 15 and 23.

## Facilitator

A facilitator is a relayer/gas payer. It MUST NOT be treated as the source of truth for balances.

## Frontend

Frontend checks are advisory only. All financial rules MUST be enforced in the protocol state machine and/or proof.

## Oracle

Oracle correctness is a system dependency. V1 trusts the configured on-chain OracleAdapter only after official Pyth EVM verification and authenticated Vela TRUSTPROCESS delivery. Stale, missing, replayed, confidence-invalid or breaker-paused updates fail closed for new risk-sensitive operations.
