# Noct Finance V1 — Vela guest

Privacy-preserving lending market for the Horizen **Vela** runtime, targeting **Base Sepolia** (chain ID `84532`).

---

## Status

**Day 1 of 14 in progress.** The toolchain truth reset is complete and independently reproducible. The protocol build (Days 2–14) has not started. See [`14-DAY-ROADMAP.md`](14-DAY-ROADMAP.md).

> **There is no release artifact.** The WASM in this repository is a *verification* build, produced
> with a stub `wasm-opt` because real binaryen is not installed here. It is genuinely runnable under
> `-scheduler=none` — there is no Asyncify transform to apply — but it must be rebuilt with real
> binaryen before anything is deployed. `tools/build-guest.ps1 -Release` enforces this and refuses
> to run without it.

## Verified build facts

| | |
|---|---|
| Toolchain | TinyGo `0.39.0` + Go `1.24.0`, asserted at build time |
| Flags | `-target=wasi -no-debug -scheduler=none -gc=conservative` |
| `noct-demo.wasm` | 309,580 bytes |
| SHA256 | `E91DA072B9314381A2E3F05E7532011B2DA1E995C2ECBAF552BD2CB51A2DF44C` |
| Imports | `total=6 asyncify=false` |
| WASI golden output | 8 / 8 lines |
| Reproducible | yes — byte-identical on rebuild |
| `noctmath` coverage | 94.2% statements |

Primary evidence: [`artifacts/BUILD-EVIDENCE.md`](artifacts/BUILD-EVIDENCE.md) and
`noct-demo-wasm/noct-demo.wasm.provenance.txt`. Both are generated, not hand-written.

## Building

Windows (canonical):

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-guest.ps1
```

Release artifact (requires real binaryen `wasm-opt` on PATH):

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-guest.ps1 -Release
```

The script asserts the toolchain pairing, resolves `wasm-opt` provenance by querying the binary
rather than trusting its filename, gates the module import table for asyncify, executes the WASI
probe and diffs it against the golden output, verifies a byte-identical rebuild, writes the evidence
manifest, and syncs the deployable. It fails closed on any gate.

`noct-demo-wasm/build.sh` is the POSIX equivalent and requires bash.

### Toolchain requirement

TinyGo `0.39.0` lives in `tools/tg039/` and Go `1.24.0` in `tools/go124/`. Both are git-ignored
(re-downloadable, ~1.3 GB). **`GOROOT` must point at `tools/go124/go`.** Without it, TinyGo binds to
whatever system Go is installed — here `1.27.1`, which cannot link `-scheduler=none` and silently
falls back to asyncify. The version string TinyGo itself prints is the authority on the pairing.
Details in [`TOOLCHAIN-LOCK.md`](NOCT-FINANCE-V1-ARCHITECTURE-DOCUMENTS-CORRECTED/TOOLCHAIN-LOCK.md).

## Layout

| Path | Contents |
|---|---|
| `noct-demo-wasm/` | guest source: `main.go`, `app/`, `noctmath/` (checked U256 kernel), `cmd/schedprobe/` |
| `tools/` | build and verification scripts, `wasm-opt` stub source |
| `artifacts/` | generated build evidence; `stale-prepin/` is quarantined pre-pin evidence |
| `NOCT-FINANCE-V1-ARCHITECTURE-DOCUMENTS-CORRECTED/` | architecture specification |
| `NOCT-FINANCE-AUDIT-V1/` | audit documents |
| `14-DAY-ROADMAP.md` | delivery plan, blocker table, per-day completion records |
| `VELA-DEV-TEAM-REQUEST.md` | open questions for the Vela / Horizen dev team |
| `noct-vela-demo/` | submodule: `HorizenOfficial/vela-starterkit` |

## Run the local interactive prototype

The repository now includes a browser client in [`local-app/`](local-app/). It runs without Docker
or external services and implements the guest's core V1 flow locally: connect a MetaMask wallet or
use the clearly labelled demo wallet, supply ETH collateral, borrow up to the 200% collateral limit,
repay, withdraw while maintaining collateralization, and inspect the private position and activity
history. State is persisted in the browser's local storage.

```powershell
cd local-app
npm run check
npm start
```

Open <http://127.0.0.1:4173>. If MetaMask is connected to a local Anvil chain (`31337`), successful
actions also emit a zero-value self-transaction with an encoded local action receipt. The browser
simulator remains usable without an RPC node; it does not claim to be a deployed Vela TEE. For the
full WASM/TEE path, use the Docker and deployment instructions below.
| `local-app/` | runnable browser prototype with EIP-1193 wallet connection, local simulator, and Vela validation bridge |

## Local browser prototype

Run the NoctFinance interface without external funds:

```powershell
cd local-app
npm start
```

Open `http://127.0.0.1:4173`. Use **Demo wallet** for an immediate local walkthrough, or connect MetaMask/Rabby on the local Anvil network (chain ID `31337`). Deposit, borrow, repay, withdraw, collateral health, protocol totals, and transaction history are functional in the browser simulator.

When the Docker Vela stack is running, validate the real WASM path with:

```powershell
node local-app/validate-vela.mjs --app-id <deployed-application-id>
```

This delegates to the existing encrypted `deploy-scripts/local-e2e-client.js` flow. See [`local-app/README.md`](local-app/README.md) for details.

After cloning, run `git submodule update --init` to populate `noct-vela-demo/`.

## Blockers

Deployment is blocked on ten unanswered questions to the Vela / Horizen dev team (B1–B10), tabulated
in `14-DAY-ROADMAP.md`. **B8** — a genuine `novaw-linux` CLI — blocks Day 1: the copy previously
tracked here was a 9-byte `Not Found` placeholder and has been removed from version control.

## A note on the documents in this repository

Earlier revisions recorded build results that the artifacts did not support: an "asyncify" guest
that was in fact a `-scheduler=none` build, a 944 KB deployable matching no mandated flag set, and
three mutually inconsistent SHA256 values for the same filename. Those claims have been corrected
against measurement, and the superseded evidence is **quarantined** under `artifacts/stale-prepin/`
rather than deleted, so the corrections stay auditable. Nothing in that directory should be cited.
