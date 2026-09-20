# 24. Privacy Leakage Analysis

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.


## Leakage channels

### Public chain
- sender;
- event timing;
- settlement recipient;
- settlement amount;
- proof metadata.

### Vela
- plaintext events;
- errors;
- debug output.

### Backend
- prover logs;
- facilitator logs;
- metrics;
- crash reports.

### Client
- analytics;
- console logs;
- local storage;
- telemetry.

## Controls

- encrypted user payloads;
- encrypted user events;
- opaque IDs;
- minimal proof public inputs;
- secret redaction;
- no financial analytics;
- short-lived sensitive buffers.

## Timing

Perfect timing privacy is not guaranteed. Analyze transition-dependent timing and avoid unnecessary public timing signals.

## External settlement

Normal public token settlement can reveal some information. The implementation must state this limitation accurately.
