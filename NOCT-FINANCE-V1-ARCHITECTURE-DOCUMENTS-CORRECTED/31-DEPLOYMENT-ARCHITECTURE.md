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
- controlled Noct USDC, ETH and ZEN reserves;
- approved test USDC.

## Artifacts to pin

Every value below MUST be recorded before deployment and MUST be reproducible from the repository.
`TOOLCHAIN-LOCK.md` is normative for toolchain versions and separates VERIFIED from OPEN pins; a
deployment MUST NOT proceed while any row is OPEN.

| Artifact | Value / source | Status |
|---|---|---|
| Vela core images | `horizen/cce-*:v0.2.0` (`docker-compose.yml`) | VERIFIED tag; **source commit and image digest OPEN** |
| `vela-common-go` | `v0.2.0` + `go.sum` hashes | VERIFIED |
| Go | `1.24.0` | VERIFIED |
| TinyGo | required by `build.sh`, **no version pinned** | OPEN — blocking |
| WASM hash | `sha256(noct-demo.wasm)`, printed by `build.sh` | Must be recorded per build |
| Circuit hash | `circuitID` (public input 4) | OPEN — no Noir source in repo |
| VK hash | `vkHash` (public input 5) | OPEN — depends on circuit and backend |
| Config hash | `configCommitment` over the File 10 field order | Derivable once config is frozen |
| Contract addresses | `OracleAdapter`, `NoctTrigger`, `ProcessorEndpoint`, Pyth `IPyth`, custody token addresses | OPEN — no contracts in repo |
| Chain ID | `chainID` (public input 3) | OPEN |
| Vela application ID | `velaApplicationID` (public input 2) | Assigned at deployment |
| Governance identity | `governanceIdentity`, authorized for `T13` | Must be a multisig |
| UltraHonk verifier variant | `V3_0` / `V0_84` / Legacy | OPEN — exactly one must be chosen |

## Deployment assertions (must fail closed)

Deployment MUST abort, not warn, if any assertion below fails. Each exists because a silent mismatch
is indistinguishable from theft or from an unprovable state.

1. **Token decimals.** For each asset, the custody token's on-chain `decimals()` equals the committed
   `nativeDecimals` — `6` for USDC, `18` for ETH, `18` for ZEN (Files 08 and 10, SPEC-02).
2. **Config bounds.** `collateralFactorWad < liquidationThresholdWad` strictly, for every asset;
   `liquidationBonusWad <= WAD`; `0 < closeFactorWad <= WAD`; `0 < minLiquidationDebtUsdWad`;
   `RAY < maxQuoteIndexDriftRay <= 1.2 * RAY`;
   `0 < maxRiskDelaySeconds <= maxOracleStalenessSeconds` (File 10).
3. **Oracle delay agreement.** The `maxRiskDelaySeconds` configured in `NoctTrigger` equals the value
   inside `configCommitment` (SPEC-08). A divergence would make the committed config a lie.
4. **Feed IDs.** Exactly three distinct Pyth feed IDs are configured, each copied from Pyth's official
   registry for the target chain, and each verified against the deployed `IPyth` contract (`18:15`).
5. **Identity freeze.** `velaApplicationID` and `chainID` are read from the actual Vela deployment and
   frozen in initial state; neither is assumed (`09:139`).
6. **Governance.** `governanceIdentity` is set, is a multisig, and is frozen; `T13` is unreachable from
   any user request path.
7. **Arithmetic kernel.** The checked U256 kernel is vendored and its conformance vectors pass
   (`TOOLCHAIN-LOCK.md`, SPEC-10). Without this, nothing else is implementable.
8. **Public-input width.** Proof public-input flattening is at most 32 for the pinned backend (`09:145`,
   `09:203`).
9. **Vela Nova.** `novaw-linux.zip` is not the 9-byte `Not Found` placeholder (SPEC-14).
10. **Genesis state.** For each reserve, `borrowIndex = RAY`, `totalScaledDebt = 0`,
    `writtenOffDebtUsd = 0`, `lastAccrualTimestamp` = the initial accepted oracle timestamp;
    `protocolBadDebtUsd = 0`; `stateVersion = 0`.

## Environment gates

| Gate | local | testnet | production |
|---|---|---|---|
| All 10 deployment assertions | MUST | MUST | MUST |
| `TOOLCHAIN-LOCK.md` free of OPEN rows | SHOULD | MUST | MUST |
| Golden vectors for all leaves and subroots (File 09) | MUST | MUST | MUST |
| ZK + E2E benchmarks (Files 27, 28) | — | MUST | MUST |
| Custody reconciliation harness (File 11) | SHOULD | MUST | MUST |
| Incident runbook + alerting on `T13`, custody mismatch, oracle breaker | — | SHOULD | MUST |

Local execution does not prove production Nitro security (`31:22`) and MUST NOT be cited as evidence
of TEE behaviour.

## Secret management

Never commit:

- private keys;
- cloud credentials;
- facilitator keys;
- RPC credentials;
- user secret material;
- the `governanceIdentity` signing key.

Secrets MUST come from the environment or a secrets manager. `docker-compose.yml` already reads
`DEPLOYER_PRIVATE_KEY`, `TEE_SIGNER_ADDRESS` and `TEE_PUB_P521` from `.env`; that file MUST be
git-ignored and MUST NOT be committed in any environment. A committed `.env` in a public repository is
a total key compromise.

