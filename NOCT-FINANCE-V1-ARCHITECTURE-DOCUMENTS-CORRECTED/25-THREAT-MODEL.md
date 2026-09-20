# 25. Threat Model

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.


## Adversaries

- passive blockchain observer;
- malicious borrower;
- malicious liquidator;
- malicious facilitator;
- compromised frontend;
- compromised RPC provider;
- oracle manipulator;
- replay attacker;
- malicious infrastructure operator;
- invalid-proof submitter.

## Protected assets

- user funds;
- protocol reserves;
- private position state;
- debt/collateral correctness;
- proof integrity;
- settlement integrity.

## Control mapping

| Threat | Control |
|---|---|
| Replay | state root + nonce + domain |
| Double withdrawal | pending lock + settlement ID |
| Invalid borrow | risk check + proof |
| Oracle spoof | authenticated snapshot |
| Facilitator abuse | signed request + encrypted payload |
| Wrong circuit | VK/circuit version binding |
| Stale state | state-version/root check |

Every real incident becomes a regression test.
