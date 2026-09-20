# Noct Finance V1 — Toolchain Lock

Complete this during repository bootstrap and commit it before reproducible implementation.

| Component | Baseline from architecture review | Exact tested value |
|---|---|---|
| Vela core | current selected commit | TODO |
| Vela Starter Kit | selected commit | TODO |
| Vela Nova | selected commit | TODO |
| Go | 1.24.0 / toolchain 1.24.3 observed in current Vela | TODO |
| Wasmtime-go | current Vela checkout | TODO |
| TinyGo | required by selected guest build | TODO |
| Node.js | 20 LTS baseline | TODO |
| pnpm | 9.x baseline | TODO |
| TypeScript | 5.7.3 baseline | TODO |
| ethers | 6.13.4 baseline | TODO |
| Noir | >= 1.0.0-beta.14 supported by zkVerify docs | TODO |
| Barretenberg/bb | >= 3.0.0 supported by zkVerify docs | TODO |
| zkVerifyJS | selected tested version | TODO |
| UltraHonk verifier | V3_0 preferred candidate | TODO |
| Solidity/Hardhat/Foundry | selected Vela-compatible versions | TODO |
| Horizon contracts | target deployment | TODO |

## CI rule

CI must print the exact versions/commits before build and test. Toolchain upgrades require repeating ZK and E2E benchmarks.
