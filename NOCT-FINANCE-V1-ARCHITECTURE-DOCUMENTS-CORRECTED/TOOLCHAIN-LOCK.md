# Noct Finance V1 — Toolchain Lock

**Status:** Normative. No implementation, benchmark or proof artifact may be produced against a
toolchain not pinned here.
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; VERIFIED = evidenced in this repository;
OPEN = not evidenced in this repository and MUST be resolved before freeze.

This file previously contained 16 rows, every one of them `TODO`, while `README.md:57` asserted the
exact values "must be written into `TOOLCHAIN-LOCK.md`". Nothing was reproducible and nothing was
buildable. Rows are now split by evidence status. A row is **VERIFIED** only where this repository
contains the artifact that pins it; a row is **OPEN** where no such artifact exists, and inventing a
plausible version number is prohibited.

---

## VERIFIED pins (evidenced in this repository)

| Component | Exact tested value | Evidence |
|---|---|---|
| Go | `1.24.0` | `noct-demo-wasm/go.mod:3` — `go 1.24.0`; asserted in `noct-demo-wasm/build.sh` (`GO_REQUIRED`) |
| TinyGo | `0.39.0` | `noct-demo-wasm/build.sh:15` — `TINYGO_REQUIRED="0.39.0"`, asserted against `tinygo version` at build time. Matches `34-IMPLEMENTATION-ROADMAP.md:13`. Verified to build `main.go` with `-scheduler=none`. |
| Go ↔ TinyGo pairing | Go **1.19–1.25** with TinyGo `0.39.0`, `GOROOT` set explicitly | Empirically enforced by TinyGo itself: `requires go version 1.19 through 1.25, got go1.27`. The pair is the pin, not either number alone — see "Scheduler resolution" below. **`GOROOT` MUST be set to the pinned Go.** TinyGo resolves its GOROOT from the environment, so a correct TinyGo against an inherited system Go still reports `tinygo version 0.39.0` while producing an asyncify artifact. Assert on the Go version embedded in TinyGo's own output (`using go version go1.24.0`), not on `tinygo version` alone. |
| `vela-common-go` | `v0.2.0` | `noct-demo-wasm/go.mod:5`; `go.sum:1-2` — `h1:aMyqvuRIpoFnod8j129EBMk09L074Urcef83HmBHuA0=`, `/go.mod h1:VGEDebTDUnwrnMycUHQtm9WBi0DpRcYjsetIU4KbRmc=` |
| Vela core images | `v0.2.0` | `noct-vela-demo/dockerfiles/docker-compose.yml` — `horizen/cce-executor` (:24), `cce-manager` (:56), `cce-authorityservice` (:119), `cce-chain` (:155), `cce-deployer` (:170), `cce-subgraph-deployer` (:271), all `${VELA_IMAGE_TAG:-v0.2.0}` |
| WASM target | `wasi`, `-no-debug`, `-scheduler=none`, `-gc=conservative` | `noct-demo-wasm/build.sh:153` — `tinygo build -o noct-demo.wasm -target=wasi -no-debug -scheduler=none -gc=conservative main.go`. Enforced on Windows by `tools/build-guest.ps1`, which asserts the toolchain pair, builds with these exact flags, gates on the import table, and publishes `noct-demo.wasm`. Previously recorded without the scheduler/GC flags, when the guest could not be built that way; see "Scheduler resolution". |
| `ethers` (installed) | `6.17.0` | `deploy-scripts/node_modules/ethers/package.json` |
| Test deps (transitive) | `testify v1.11.1`, `go-spew v1.1.1`, `go-difflib v1.0.0`, `yaml.v3 v3.0.1` | `noct-demo-wasm/go.sum:3-10` |
| Postgres | `14` | `docker-compose.yml:194` |
| IPFS (Kubo) | `v0.17.0` | `docker-compose.yml:219` |

`VELA_IMAGE_TAG` MUST be set explicitly to `v0.2.0` in every environment. The compose default
`${VELA_IMAGE_TAG:-v0.2.0}` means an exported-but-different value silently overrides the pin, so CI
MUST assert the resolved tag rather than rely on the default.

## Scheduler resolution: `-scheduler=none` IS achievable

The guest MUST be built with `-scheduler=none`. A cooperative or preemptive scheduler inside the TEE
introduces task interleaving and time-slice behaviour the host can neither observe nor reproduce,
which is incompatible with a deterministic execution artifact.

An earlier revision of this repository recorded that the mandate **could not be met**, and that
`build.sh` therefore fell back to the default asyncify scheduler. That conclusion was **wrong**. It
was a property of the toolchain *pair* that happened to be installed, not of the guest code:

| Toolchain pair | `-scheduler=none` | Result |
|---|---|---|
| TinyGo `0.42.0` + Go `1.27.1` | fails to link | `...\Go\src\time\sleep.go:182:2: attempted to start a goroutine without a scheduler`, reached via `vela-common-go/wasm/utils` `LogInfo` → `time.Sleep` |
| TinyGo `0.39.0` + Go `1.24.0` | **links cleanly** | guest and probe both build, run, and import no asyncify host functions |

TinyGo `0.39.0` also *rejects* Go `1.27` outright (`requires go version 1.19 through 1.25`), so the
two pins are not independently substitutable. **The pin is the pair.**

`-scheduler=tasks` is not an escape under either version: it does not link for wasm32 at all
(`internal/task` fails with `undefined: calleeSavedRegs`). `none` is the only schedulable
configuration, which is why the pairing has to be exact rather than approximate.

### Evidence

Produced with TinyGo `0.39.0`, Go `1.24.0`, `-target=wasi -no-debug -scheduler=none
-gc=conservative`, `GOTOOLCHAIN=local`, and an **explicitly set `GOROOT`** pointing at the pinned Go.
Regenerated and gated by `tools/build-guest.ps1`; recorded in `artifacts/BUILD-EVIDENCE.md`.

| Check | Result |
|---|---|
| Real guest `main.go` links | PASS — `artifacts/guest_final.wasm`, 309,580 bytes |
| Guest instantiates and runs under WASI | PASS — exit 0, no trap |
| Asyncify imports in guest | **NONE** — `total=6 asyncify=false`; only `fd_write`, `proc_exit`, `clock_time_get`, `args_sizes_get`, `args_get`, `random_get` |
| Asyncify imports in probe | **NONE** — `total=3 asyncify=false`; only `fd_write`, `proc_exit`, `random_get` |
| noctmath probe links | PASS — `artifacts/probe_final.wasm`, **16,625 bytes** |
| Probe runs under WASI | PASS — exit 0 |
| Probe output vs native Go golden | PASS — **8/8 lines identical, 0 diffs** |
| Host unit tests (`go test ./noctmath/...`) | PASS — `noctmath` coverage **94.2%** |
| `go vet ./...` | PASS — no findings |
| Byte-identical rebuild | PASS — see "Build reproducibility" |

**Three values in this table were previously wrong and are corrected here.** They are
recorded explicitly because an uncorrected plausible-looking number is worse than a gap:

| Was | Now | Why it changed |
|---|---|---|
| probe `123,840` bytes | `16,625` bytes | The probe was built *without* `-no-debug -gc=conservative`, so it did not use the mandated flags. Building it with them shrinks it ~7.4x. Both are `asyncify=false`; the smaller one is the correct evidence. |
| golden `24/24` lines | `8/8` lines | `cmd/schedprobe/expected.txt` contains 8 lines. No 24-line golden file exists in the repository. |
| coverage `94.6%` | `94.2%` | Re-measured with the pinned Go 1.24.0. |

### Build reproducibility

Repeated independent builds of the guest produced a **byte-identical** artifact. The guest hash below
was reproduced again in a later session by an independently invoked build, and `tools/build-guest.ps1`
now re-verifies it on every run by building twice and comparing:

| Artifact | SHA256 (full) | Builds agreeing |
|---|---|---|
| guest (`main.go`) | `E91DA072B9314381A2E3F05E7532011B2DA1E995C2ECBAF552BD2CB51A2DF44C` | all builds, across sessions |
| noctmath probe (`-no-debug -gc=conservative`) | `981C58F369C100542778D7DBBA0449742C0516F42C31783F8333118455E1B53D` | 2 of 2 |

The probe hash recorded here supersedes the earlier `6008449682497D72215E7B8B2BD09316`, which was the
hash of a probe built **without** the mandated `-no-debug -gc=conservative` flags (123,840 bytes). That
artifact was not evidence of the pinned build and has been quarantined to
`artifacts/stale-prepin/`.

Notably the guest hash is unchanged across the addition of `noctmath/spec10.go`: the new
`(U256, ok bool)` surface is not referenced by the guest's call graph, so it is dead-code eliminated
and the emitted module is identical. Renaming `MulDivDown` → `MulDivDownErr` likewise does not perturb
codegen, since symbol names are internalized. This is useful evidence that the SPEC-10 API change is
behaviourally inert for the shipped artifact.

**Scope of this claim.** All of these builds used `tools/wasmoptstub` (a pass-through) as `WASMOPT`,
so what is demonstrated is determinism of **TinyGo + LLVM** for this source and pin pair. It does not
establish reproducibility of a *release* artifact, because real binaryen `wasm-opt` has its own
version-dependent output. A release reproducibility claim MUST re-run this comparison with real
binaryen at a pinned version.

### Evidence hygiene: how the record came to contradict itself

The `-scheduler=none` guest artifacts in this repository were **correct all along**. What was wrong was
the evidence describing them, and the gap matters because a correct artifact accompanied by false
evidence is indistinguishable from a broken one.

`artifacts/imports_guest.txt` recorded `total=14 asyncify=true` and was filed as guest evidence. It had
actually been generated from `noct-demo-default.wasm` — the *default asyncify* build — so it described a
different module than the one it was cited against. Read next to `guest_final.wasm` it appeared to
contradict the `total=6 asyncify=false` claim above and made a deployable artifact look undeployable.

Two causes, both structural:

1. **Nothing enforced the toolchain pair on Windows.** `build.sh` asserts `GO_REQUIRED` and
   `TINYGO_REQUIRED` and sets `GOROOT`, but it needs a POSIX shell. Invoking a bare `tinygo` instead
   resolved to system TinyGo `0.42.0` + Go `1.27.1`, which cannot link `-scheduler=none` and silently
   falls back to asyncify. `tools/build-guest.ps1` now closes this by asserting the Go version embedded
   in TinyGo's own output before building.
2. **Provenance was inferred from names and PATH position.** `tools/wasmoptstub` sits on the persistent
   user PATH, so any `wasm-opt.exe` placed in that directory is picked up machine-wide as `wasm-opt` and
   reported as real binaryen. Provenance MUST be established by asking the binary
   (`wasm-opt --version`) and matching its self-identification, never by its filename.

Normative rules added as a result:

- Evidence files MUST be regenerated by the same script invocation that produced the artifact. A
  hand-carried `imports_*.txt` is not evidence.
- Evidence timestamps MUST post-date toolchain provisioning. Pre-pin evidence is quarantined, not
  deleted, under `artifacts/stale-prepin/` with a README stating why it must not be cited.
- The deployable path (`noct-demo-wasm/noct-demo.wasm`, consumed by `deploy-scripts/deploy.js`,
  `quickstart.sh` and `demo-transaction.sh`, and hashed per `31-DEPLOYMENT-ARCHITECTURE.md:45`) MUST be
  synced from the gated build and carry a `.provenance.txt` sidecar. It had drifted to a 966,462-byte
  module matching none of the mandated flags while the documentation described a different artifact.
- `VERIFIED` means the artifact **and** the evidence describing it are consistent and reproducible.
  Since `.gitignore` excludes `*.wasm` and `*.log`, the durable record MUST live in
  `artifacts/BUILD-EVIDENCE.md`, which is not ignored.

### Consequences for the binaryen / `wasm-opt` requirement

Because the mandated build has **no asyncify**, there is no Asyncify transform to apply. This changes
what `wasm-opt` is needed for, and the distinction determines whether a stub is acceptable:

- `-scheduler=none`: `wasm-opt` only shrinks the module. A stub-built artifact is still fully
  **runnable**, since it imports no asyncify host functions. The stub is therefore valid for local
  verification.
- default asyncify scheduler: `wasm-opt` MUST be real binaryen to perform Asyncify instrumentation.
  A stub-built module links successfully and then **fails at instantiation** — the failure mode that
  motivated the original runnability gate.

TinyGo still invokes `wasm-opt` unconditionally for every wasm target, so binaryen (or `WASMOPT`)
remains a hard build prerequisite; what changed is that a stub no longer produces a non-runnable
module. A **release** artifact MUST still be built with real binaryen so the shipped size and the
recorded SHA256 correspond to the optimized module.

`build.sh` retains the post-build import inspection gate. Under `-scheduler=none` it now passes; if
any future change reintroduces asyncify while a stub is in use, the gate fails the build instead of
shipping a module that links and then cannot be instantiated.

### CI requirement

CI MUST assert **both** versions and their compatibility, not just TinyGo's, and MUST set
`GOTOOLCHAIN=local` **and an explicit `GOROOT`** so neither an automatic toolchain download nor an
inherited system Go can substitute a different Go mid-build and silently break reproducibility. CI MUST
additionally assert the Go version embedded in `tinygo version` output (`using go version go1.24.0`),
because that string — not `tinygo version` alone — is the only reliable witness to the pairing that
actually produced the artifact. `build.sh` does this via `TINYGO_REQUIRED`, `GO_REQUIRED` and the
`go version` assertion.

## OPEN pins (no evidence in this repository — CI-blocking)

These rows were `TODO` and remain unresolved because the repository genuinely does not contain the
artifact. Each is a **hard gate**: the build MUST fail, not warn, until it is filled from a real
checkout or a real release.

| Component | Baseline from architecture review | Status | Required resolution |
|---|---|---|---|
| Vela core **source commit** | images are `v0.2.0` but binary | OPEN | Record the git commit that built `horizen/cce-*:v0.2.0`, plus its SHA256 manifest digest. An image tag is mutable; a digest is not. |
| Vela Starter Kit | `noct-vela-demo/dockerfiles` is a derivative | OPEN | Record the upstream Starter Kit commit this directory was forked from. |
| **Vela Nova** | `novaw-linux.zip` | **BLOCKED** | See SPEC-14 below. |
| Wasmtime-go | host-side dependency of Vela core | OPEN | Absent from `noct-demo-wasm/go.sum`, so it is a *host* dependency. Record the version inside `horizen/cce-executor:v0.2.0`. |
| ~~TinyGo~~ | required by `build.sh` | **RESOLVED** | Was: "`build.sh` checks only `command -v tinygo` and pins **no version**... the single most consequential unpinned row." `build.sh:15` now pins `TINYGO_REQUIRED="0.39.0"` and `build.sh:33` asserts it against `tinygo version`, failing the build on mismatch. Moved to the VERIFIED table above. |
| Node.js | 20 LTS | **CONTRADICTED** | No `.nvmrc` and no `engines` field exists in either `deploy-scripts/package.json` or `noct-demo-wasm/package.json` (verified). Add both. Meanwhile three sources disagree: this row says `20 LTS`, `34-IMPLEMENTATION-ROADMAP.md:14` says `20.11.x LTS`, and the machine that actually ran the Phase 0/1 verification has **`v22.20.0`** (`node -v`). Nothing in the repository constrains the version, so all Phase 0 artifacts were produced under Node 22. Either pin `20.11.x` and re-verify every Node-dependent artifact under it, or move the baseline to `22.x` — but the recorded pin MUST match the version that produced the evidence, otherwise "verified" is not reproducible. |
| pnpm | 9.x | **CONTRADICTED** | `README.md:47` claims pnpm 9.x, but the repository contains `deploy-scripts/package-lock.json` (**npm**) and no `pnpm-lock.yaml`. Resolve the package manager before pinning its version; a lockfile from one manager does not reproduce under another. The disagreement is now four-way: `README.md` says `9.x`, `34-IMPLEMENTATION-ROADMAP.md:15` says `8.15.x`, the committed lockfile is **npm** (`package-lock.json`, resolved with `npm 10.9.3`), and the machine that ran verification has `pnpm 11.5.2` installed. Since no `pnpm-lock.yaml` exists anywhere, the only package manager with reproducible evidence in this repository is **npm**. |
| TypeScript | 5.7.3 | OPEN | `noct-demo-wasm/test-client.ts` exists but no `typescript` dependency is declared in either `package.json`. |
| `ethers` (declared) | 6.13.4 | **NOT A PIN** | `noct-demo-wasm/package.json` declares `^6.9.0` and `deploy-scripts/package.json` declares `^6.13.0`. Caret ranges resolve forward, and the installed tree is already `6.17.0` — not the `6.13.4` baseline. Both MUST become exact, with a committed lockfile. |
| Noir | >= 1.0.0-beta.14 | OPEN | No Noir source exists in this repository. Required by Files 13-15. |
| Barretenberg / `bb` | >= 3.0.0 | OPEN | As above; must be compatible with the chosen Noir. |
| zkVerifyJS | selected tested version | OPEN | No zkVerify client code exists here. |
| UltraHonk verifier | `V3_0` preferred | OPEN | `README.md:53` lists `V3_0`/`V0_84`/Legacy as *candidates*. One MUST be chosen and frozen; `V3_0` and `V0_84` produce different proofs for the same circuit. |
| Solidity / Hardhat / Foundry | Vela-compatible | OPEN | No Solidity, Hardhat or Foundry artifact exists, yet Files 15, 17 and 18 require `OracleAdapter`, `NoctTrigger` and `ProcessorEndpoint` contracts. |
| Horizon contracts | target deployment | OPEN | No deployment address or chain ID is recorded. `chainID` is proof public input 3 (`09:150`) and MUST be frozen. |
| `graph-node` | — | **UNPINNED** | `docker-compose.yml:241` uses `graphprotocol/graph-node` with **no tag**, resolving to a floating `latest`. Non-deterministic; MUST be pinned. |

### SPEC-14: `novaw-linux.zip` is a failed download, not an archive

The repository contains `novaw-linux.zip` at **9 bytes** whose entire content is the ASCII string
`Not Found`. It is an HTTP error body captured by a failed fetch, not a Vela Nova distribution. Any
tooling that unpacks it will fail, and any process that treats its presence as "Nova is vendored"
will silently proceed without it.

Required resolution:

1. Delete the placeholder or replace it with the real artifact.
2. Record the artifact's SHA256 in this file.
3. Add a CI gate that fails when the file is smaller than 1 MiB or when its SHA256 does not match.
4. Do not reference Vela Nova in any build path until the above holds.

---

## Arithmetic kernel (SPEC-10 — normative, blocking)

Files 08, 10, 11, 12 and 19 all specify the protocol's arithmetic exclusively through two primitives,
`mulDivDown(a, b, den)` and `mulDivUp(a, b, den)`. Every economic quantity in V1 passes through them:
debt derivation (`08:74-81`), USD weighting and both risk gates (`10`), reserve accounting (`11`),
borrow/repay/close-factor/cross-asset conversion (`12`), and index accrual (`19`).

**The pinned SDK cannot express them.** Verified against
`github.com/HorizenOfficial/vela-common-go@v0.2.0` (`wasm/types/uint256.go`, `helpers.go`,
`common.go`), the complete public arithmetic surface of `types.Uint256` is:

```text
Add, AddOverflow, Add64, Add64Overflow      uint256.go:81,91,325,330
Sub, SubOverflow                            uint256.go:101,111
Mul64, Mul64Overflow                        uint256.go:305,310
Cmp, Eq, IsZero                             uint256.go:125,141,146
SetBytes, Bytes, SetHex, ToHex, String      uint256.go:33,58,69,191,151
MarshalJSON, UnmarshalJSON                  uint256.go:219,225
divModWord(divisor uint64)                  uint256.go:174   <- UNEXPORTED
```

Four blocking gaps:

1. **No U256 × U256 multiplication.** The only multiply is `Mul64(y uint64)`. `mulDivDown` requires a
   256×256→512-bit intermediate, which cannot be formed.
2. **No public division of any kind.** The sole division helper `divModWord` is unexported and takes a
   `uint64` divisor. A guest cannot divide a `Uint256` by a `Uint256` at all, so `mulDivDown`'s final
   `/ den` step is unreachable even if a wide product could be built.
3. **WAD-scaled prices cannot be passed to `Mul64`.** `12:402` needs
   `mulDivUp(paymentAmount, debtPrice, WAD)` where `debtPrice` is an 18-decimal WAD price. Any token
   above roughly **$18.45** has a WAD price exceeding `2^64` and does not fit the `uint64` parameter.
   The frozen liquidation formula is not merely imprecise — it is **not expressible**.
4. **`Mul64` silently truncates.** Source-verified at `uint256.go:304-307`: it computes
   `Mul64Overflow` and then explicitly discards the flag (`_ = z.Mul64Overflow(y)`). A wrapped product
   is indistinguishable from a correct one. This is the precise enabler of `DEMO-01`.

`helpers.go` offers only `SerializeAndWriteResult`, `PtrToUint256` and `PtrToAddress`; it provides no
math. There is therefore **no arithmetic kernel in this repository**, and the demo substituted native
Go `uint64`.

Separately, `23:16` and `12` require a **deterministic withdrawal ID** for replay protection, but
`types.Withdrawal` (`common.go:22-26`) has exactly three fields — `TokenAddress`, `DestinationAddress`,
`Amount` — and **no ID**. The withdrawal-ID replay domain cannot be implemented against the host type
as pinned. This MUST be resolved by either a Noct-side deterministic ID carried in the guest state and
committed in `historyRoot`'s `outcomeCommitment` (`09:112`), or a host type change; it MUST NOT be left
implicit.

This section is a hard requirement, not guidance.


### Required surface

The implementation MUST provide, over an unsigned 256-bit type, at minimum:

```text
Add(a, b)    -> (U256, ok bool)     # ok=false on overflow
Sub(a, b)    -> (U256, ok bool)     # ok=false on underflow
Mul(a, b)    -> (U256, ok bool)     # ok=false on overflow
Div(a, b)    -> (U256, ok bool)     # ok=false when b == 0
MulDivDown(a, b, d) -> (U256, ok bool)
MulDivUp(a, b, d)   -> (U256, ok bool)
FromBytes32(be [32]byte) -> (U256, ok bool)   # rejects non-canonical width
ToBytes32(a)   -> [32]byte
Cmp(a, b)    -> int
```

### Conformance status (verified)

`noct-demo-wasm/noctmath/spec10.go` provides exactly the surface above. Conformance is enforced at
**compile time**, not just by tests: `spec10_test.go` contains package-level assertions of the form
`_ func(a, b U256) (U256, bool) = Add` for every named function, so any signature drift from this
section stops the build. That is the gate that prevents the earlier `(U256, error)` vs
`(U256, ok bool)` divergence from recurring.

| Property | Status | Where |
|---|---|---|
| 1. Full-width 512-bit intermediate | MET | `mul512`/`quoRem512` in `div.go`; `TestSpec10FullWidthIntermediate` proves `MulDivDown(2^200,2^200,2^200)=2^200` while `Mul(2^200,2^200)` fails |
| 2. Explicit success flag, no panic/trap/wrap | MET | `TestSpec10FailureReturnsZeroNotWrapped` — every failure path returns `ok=false` **and** `Zero()`, never a wrapped value |
| 3. No native integer fallback | MET | financial paths use `U256`; `math/bits` is used only for 64-bit limb primitives inside the kernel, not as a substitute for it |
| 4. `MulDivUp` zero semantics | MET | `TestSpec10MulDivUpZeroSemantics` — `MulDivUp(0,b,d)=MulDivUp(a,0,d)=0` with `ok=true` |
| 5. Vendored **or** implemented in-repo with its own test suite | MET (in-repo branch) | `noctmath` is implemented in-repo with 94.6% statement coverage, golden vectors, and differential tests against `math/big`. No `^`-ranged module dependency is involved. |
| 6. Single implementation | MET | the `(U256, ok bool)` surface is a thin adapter over the one checked implementation; `TestSpec10BoolChannelMatchesErrChannel` asserts the two failure channels cannot diverge over all edge combinations |

Property 5 is satisfied by the "implemented in-repo with its own test suite" branch. Note this is
**weaker than `34-IMPLEMENTATION-ROADMAP.md:65`**, which asks for an *audited* library. The two
documents therefore set different bars for the same kernel: SPEC-10 permits what exists, the roadmap
does not. That conflict is recorded against the roadmap line and MUST be resolved deliberately rather
than by assuming the stricter text was satisfied — in-repo implementation with tests is not a
substitute for an independent security audit.

### Non-negotiable properties

1. **Full-width intermediate.** `MulDivDown` and `MulDivUp` MUST evaluate `a × b` at 512 bits before
   dividing. They MUST NOT be implemented as a checked 256-bit `Mul` followed by a `Div`: that
   construction rejects mathematically representable quotients. For example
   `MulDivDown(2^200, 2^100, 2^100)` equals `2^200` exactly, yet the naive form overflows the
   intermediate and fails. `19:54` states this requirement; it is the reason a naive wrapper is
   non-conformant.
2. **Explicit error return.** Every operation returns a success flag. Arithmetic MUST NOT use a panic,
   a trap or a TinyGo overflow-wrap as its failure policy. A wrapped result is indistinguishable from
   a legitimate small value, which is precisely the mechanism of `DEMO-01`.
3. **No native integer fallback.** Financial code MUST NOT use Go `uint64`, `int`, `float32`,
   `float64`, `math/big`, or `math/bits`-only constructions. `uint64` remains permitted solely for
   nonce, version, epoch and timestamp (`08:34`).
4. **`MulDivUp` zero semantics.** `MulDivUp(a, b, d) = 0` when `a = 0` or `b = 0`, per `19:51`. Any
   other convention changes every debt and index calculation.
5. **Vendored, not floating.** The kernel MUST be vendored into the repository with its license and a
   recorded SHA256, or implemented in-repo with its own test suite. A `^`-ranged module dependency for
   financial arithmetic is prohibited.
6. **Single implementation.** WASM guest, circuits, off-chain clients and tests MUST share one
   implementation or one set of golden vectors. Two implementations that round differently are two
   protocols.

### Required conformance vectors

The kernel MUST ship with, at minimum:

- `MulDivDown` / `MulDivUp` where `a × b` exceeds `2^256 - 1` but the quotient does not;
- `a = 0`, `b = 0`, `d = 0`, `d = 1`, `a = 2^256 - 1`;
- `MulDivUp(x, RAY, index)` and `MulDivDown(x, RAY, index)` for `index = RAY` and `index > RAY`;
- the RAY/WAD boundary values used by `mulDivUp(scaledDebt, borrowIndex, RAY)`;
- every overflow case above asserted to return `ok = false` rather than a wrapped value;
- `quantizeDown` and `wadToNative` (File 08) for `quantum = 10^12` (USDC) and `quantum = 1`
  (ETH, ZEN), including a value whose low 12 decimal digits are all nonzero.

Until this kernel exists, is vendored and passes these vectors, **no other part of the specification
is implementable**, regardless of how precisely it is written.

---

## CI rule

CI MUST print the exact resolved version of every row above before build and test, and MUST fail on:

- any row still marked OPEN or BLOCKED;
- any resolved value differing from this file, including a `VELA_IMAGE_TAG` override and an untagged
  `graphprotocol/graph-node`;
- a caret or tilde range appearing in any `package.json` for a financial or cryptographic dependency;
- a missing or mismatched lockfile, or a lockfile from a different package manager than the one CI uses;
- absence of the arithmetic kernel, or failure of any of its conformance vectors;
- `novaw-linux.zip` present as a placeholder.

Toolchain upgrades require repeating the ZK and E2E benchmarks in Files 27 and 28, and re-freezing
`vkHash` and `circuitID`, because the proof backend is part of the pinned surface.
