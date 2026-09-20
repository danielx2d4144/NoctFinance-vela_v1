# 31. Deployment Architecture

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.


## Environments

```text
local → testnet → production
```

## Local

Use the Vela Starter Kit local environment for:
- WASM;
- contracts;
- request lifecycle;
- integration testing.

Local execution does not prove production Nitro security.

## Testnet

Use:
- target Horizon testnet;
- deployed Vela;
- zkVerify test environment;
- controlled Noct ZEN/ETH reserves;
- approved test USDC.

## Artifacts to pin

```text
Vela commit
WASM hash
circuit hash
VK hash
config hash
contract addresses
chain ID
toolchain versions
```

## Secret management

Never commit:
- private keys;
- cloud credentials;
- facilitator keys;
- RPC credentials;
- user secret material.
