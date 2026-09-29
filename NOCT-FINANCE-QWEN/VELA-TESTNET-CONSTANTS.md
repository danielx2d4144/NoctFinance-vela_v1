# Vela Testnet — Constants, Reply Record and Verification

**Project:** Noct Finance V1
**Source:** Reply from the Horizen / Vela team, **part 1 of 3**, received 2026-09-28.
**Status of this file:** part 1 recorded. Parts 2 and 3 pending — append, do not rewrite.

> Every value below is marked as either **REPLY** (asserted by the Horizen team, not yet
> independently checked) or **VERIFIED** (checked by us, with the method stated). Do not
> promote a REPLY value to VERIFIED without recording how.

---

## 0. Headline: what part 1 changes

| Blocker | Was | Now | Basis |
|---|---|---|---|
| **B1** `ProcessorEndpoint` | ⬜ | ✅ **RESOLVED** | Reply + on-chain `eth_getCode` + status page agree |
| **B2** `TEEAuthenticator` | ⬜ | ✅ **RESOLVED** | Reply + on-chain `eth_getCode` |
| **B8** real `novaw-linux` | ⬜ | ✅ **RESOLVED** | Real 14 MB asset with GitHub-published SHA-256; also buildable from public source |
| **B9** deployment gating | ⬜ | ✅ **ANSWERED — and the answer is bad news** | Permissioned. See §5. |
| **B4** `AuthorityRegistry` | ⬜ | 🟡 **PARTIAL** | An `AuthorityServiceURL` (HTTP service) was given, not a contract address |
| B3, B5, B6, B7, B10 | ⬜ | ⬜ **STILL OPEN** | Not addressed in part 1 |
| **B11 (new)** `DEPLOYER_ROLE` | — | ⛔ **CRITICAL** | We cannot deploy at all until Horizen grants it |

**Two findings dominate everything else:**

1. **Deployment is permissioned** — "only Horizen can deploy new apps". Our Days 13/14 as
   written assume we register our own application. We cannot. This is now the project's
   top blocker (§5), and it is not solvable by any amount of local engineering.
2. **The reply contains a factual error** in an event name that would silently break any
   indexer built from it (§4). Recorded here so it is not propagated.

---

## 1. Network instances

Two Vela instances are live. **Base Sepolia is our target** and matches the constant we
already pinned, so no re-plumbing of the chain decision is required.

| | Horizen L3 Testnet | **Base Sepolia (our target)** |
|---|---|---|
| Status page | https://vela-facilitator-testnet.horizenlabs.io/#status | https://vela-facilitator-base-testnet.horizenlabs.io/#status |
| `rpcUrl` | `https://horizen-testnet.rpc.caldera.xyz/http` | `https://sepolia.base.org` |
| Chain ID | `2652444` (`0x28751c`) — **VERIFIED** | `84532` (`0x14a34`) — **VERIFIED**, matches existing pin |
| `ProcessorAddress` | `0xD057f11f95e949Bf64C59EefD2bbe5465538D0c2` | `0xd5E405a84753635608E7a28A59D7349BB2DAaEeF` |
| `TeeAuthenticatorAddress` | `0xCb75dE475d7590E380abB04d3c94B51c95e77c12` | `0x69Ca935A17e3920B80DB71d723Aee918e1aE75E3` |
| `AuthorityServiceURL` | `http://34.246.94.215:8181` | `http://34.246.94.215:8081` |
| `SubgraphURL` | `.../subgraphs/vela-horizen-l3-testnet/0.2.0/gn` | `.../subgraphs/vela-base-sepolia/0.2.0/gn` |
| `ApplicationID` | `17812598362091411873` | `11579806367557720661` |

Subgraph base (both): `https://api.goldsky.com/api/public/project_cml7x1bnbintv01xu7tih85gl/subgraphs/`

⚠️ **Those `ApplicationID` values are `vela-nova`'s, not ours.** They are the only app
installed on either instance. Our own ID is assigned when *our* app is deployed, and per
`wallet.conf.template` it is "assigned during deploy" — so File 31 assertion 5 (read it,
never assume it) still applies to us unchanged.

### 1.1 On-chain verification we performed

`eth_getCode` against the live RPCs, 2026-09-28. All four addresses hold real bytecode —
none is an EOA or an undeployed slot:

| Address | Chain | Code length | Verdict |
|---|---|---|---|
| `0xd5E405a84753635608E7a28A59D7349BB2DAaEeF` | Base Sepolia | 46,494 hex chars (≈23.2 KB) | **VERIFIED contract** |
| `0x69Ca935A17e3920B80DB71d723Aee918e1aE75E3` | Base Sepolia | 7,396 hex chars (≈3.7 KB) | **VERIFIED contract** |
| `0xD057f11f95e949Bf64C59EefD2bbe5465538D0c2` | L3 | 46,494 hex chars | **VERIFIED contract** |
| `0xCb75dE475d7590E380abB04d3c94B51c95e77c12` | L3 | 7,396 hex chars | **VERIFIED contract** |

Bytecode **length** is identical for each pair across the two chains, consistent with the
same `v0.2.0` deployment on both. This is *not* proof the bytecode is identical — that
would require hashing the returned code. Recorded as suggestive, not established.

The Base Sepolia status page independently corroborates the reply on every field it
displays: `ProcessorEndpoint 0xd5E405a84753635608E7a28A59D7349BB2DAaEeF`, "Base Sepolia
Testnet (chainId 84532)", RPC `https://sepolia.base.org:443`, the same SubGraph URL, and
"Version 0.2.0". **Two independent sources agree**, so B1 and B2 are safe to hardcode.

---

## 2. Version alignment

The reply's `0.2.0` subgraph versions line up with what we had already pinned from
`go.sum` and `docker-compose.yml`: facilitator codebase `0.2.0`, subgraphs `0.2.0`,
`vela-nova` tag `v0.2.0`, our pinned `vela-common-go` `v0.2.0`, our pinned
`horizen/cce-*` images `v0.2.0`. Everything is on one coherent line; no version-skew work
is implied by part 1. The **source commit and image digest** for `horizen/cce-*:v0.2.0`
remain open (deferred D15) — the `vela-nova` release commit `44f6093` is the wallet/app
repo, not the CCE images, so it does not close D15.

---

## 3. B8 resolved — real `novaw-linux`, with digests

The 9-byte `Not Found` placeholder is definitively superseded. Release
[`v0.2.0`](https://github.com/HorizenOfficial/vela-nova/releases/tag/v0.2.0), commit
`44f6093`, published `2026-07-02T12:51:39Z`, tagged from `main`, carrying a **GitHub
verified signature** (GPG key `B5690EEEBB952194`).

| Asset | Size (bytes) | SHA-256 (published by GitHub) |
|---|---|---|
| `novaw-linux` | 14,034,960 | `6ab01f2f0a4e5556a6d9bdc432058b372bdfa19b57e404d27f45df60368941a2` |
| `payment_app.wasm` | 810,693 | `37b376d4ab377e2504fd0f51063d7c6748e3c275a07d47bda5b40ca20ffadb0c` |
| `wallet.conf.template` | 729 | `13ce773a20f4099e6409f11d54c92495d8e328c8240ea2d8586db1e14e225ed8` |

Download base: `https://github.com/HorizenOfficial/vela-nova/releases/download/v0.2.0/<asset>`

The page reports **5 assets**; we captured metadata for the 3 above. The other 2 are most
likely GitHub's auto-generated `Source code (zip)` / `(tar.gz)`, but that is an inference,
**not verified** — re-enumerate before relying on the count.

We have **not downloaded or hash-checked these files yet.** The digests above are
GitHub's published values, transcribed; they become VERIFIED only once a local download
hashes to them. That check is a concrete next action needing no further input from Horizen.

### 3.1 `payment_app.wasm` is a reference guest — high value

A **real, working Vela guest artifact** (810,693 bytes, `application/wasm`). Our
`noct-demo.wasm` is 309,580 bytes. Comparing the two — import table, export table,
asyncify usage, memory layout — is the fastest available route to the "WASM envelope
requirements" the reply's context line promised, and it is entirely local work. Treat it
as evidence to compare against, not as something to copy blindly.

### 3.2 We may not need their binary at all

The wallet is public Go source at
[`HorizenOfficial/vela-nova/wallet`](https://github.com/HorizenOfficial/vela-nova/tree/main/wallet)
(`main.go`, `app/`, `cmd/`, `go.mod`, `go.sum`). Documented build is simply `go build -o novaw`.

So B8 has two independent paths to closure: download-and-verify the 14 MB asset against
the digest above, **or** build from source with our already-pinned Go `1.24.0`. The source
path removes the external dependency entirely and lets us read exactly what the CLI signs
and submits.

### 3.3 `wallet.conf` — exact keys (VERIFIED, template fetched directly)

```ini
keyP521=
keySecp256k1=
rpcUrl=
ProcessorAddress=
TeeAuthenticatorAddress=
AuthorityServiceURL=
SubgraphURL=
# On-chain application ID assigned during deploy (required for all commands except deployapp and key management)
ApplicationID=
BlockchainPollingInterval=
BlockchainPollingTimeout=
# Maximum number of events to scan when looking for a token balance (default: 200)
# PrivateBalanceScanDepth=200

# ERC-20 token registry (optional)
# token.USDC.address=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
# token.USDC.decimals=6
```

Two notes: the wallet needs **both** a P-521 key and a secp256k1 key, which independently
confirms our architecture's P-521 assumption; and the commented `token.USDC.*` examples
use **mainnet** addresses, so they must not be copied into a Base Sepolia config — our
verified testnet USDC is `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.

### 3.4 Wallet commands (from the wallet README)

```bash
./novaw help
novaw generatekeys
novaw downloadreport --report-id <hexReportId>          # needs rpcUrl + AuthorityServiceURL
novaw deployapp --wasm /path/to/app.wasm --max-value-fee "100 wei"
```

`deployapp` uploads the WASM to authorityservice at `/deploy/upload` and submits a deploy
descriptor payload with `mode=artifact_ref` on-chain. The README states the operational
requirement verbatim:

> **Operational requirement:** the wallet deploy sender must be allowed on-chain by
> `ProcessorEndpoint` (**`DEPLOYER_ROLE`**).

That single sentence is the concrete mechanism behind B9, and it becomes blocker B11 (§5).

---

## 4. ⚠️ Correction to the reply — event name is wrong

The reply says the status page shows:

> `RequestCompleted` + `OnChainRefound` -> posting of result payload from the TEE + refund of ETH

**There is no event called `OnChainRefound`.** The live Base Sepolia status page and the
subgraph both show **`OnChainRefund`**. This is a typo in the reply, but an indexer, ABI
binding or subgraph query written from the reply text would silently match nothing — the
worst class of bug, because it fails quietly rather than loudly.

**Use `OnChainRefund`.** The reply also names only three events; five were observed:

| Event | Seen on Base Sepolia status page | Meaning |
|---|---|---|
| `RequestSubmitted` | ✅ | new request, with submitter address |
| `RequestCompleted` | ✅ | result payload posted from the TEE; carries ✓/✗ and error text |
| `OnChainRefund` | ✅ | ETH change returned (reply's misspelled "Refound") |
| `OnChainWithdrawal` | ✅ **not mentioned in reply** | native token withdrawal to a user |
| `ClaimExecuted` | ✅ **not mentioned in reply** | pending balance claimed |

### 4.1 Observed failure semantics

A real failed request appears as:

```
RequestCompleted ✗ failed (error 6): failed to process request:
  Insufficient balance 0 for withdrawal 1 for account 0x2eaaf231ce583b7cd7a
```

So **error code 6 = insufficient balance**, surfaced through `RequestCompleted` rather than
a revert, and a refund is still issued on failure. Our client must treat
`RequestCompleted` as "the TEE answered", not "the operation succeeded", and branch on the
error field. Observed refunds on failed calls were 40–90 wei, i.e. the unused remainder of
the fee — consistent with the reply's "remaining funds as change of fee".

### 4.2 Evidence relevant to B6 (USDC)

The status page shows a completed **`OnChainWithdrawal` of 0.15 USDC** to a user address,
with a matching `ClaimExecuted`, on Base Sepolia, block 43,661,845 (2026-07-03).

This is strong empirical evidence that USDC works as a withdrawal asset on this Vela
instance. It does **not** formally answer B6 ("is
`0x036CbD53842c5426634e7929541eC2318f3dCF7e` on the `TokenAllowlist`?"), because the
withdrawn token's address is not shown in the summary row. B6 stays open, but is now
downgraded from unknown to probably-fine, and can likely be settled by one subgraph query
against that request ID (`0xa911ed80…0dd430b9`) rather than by asking.

### 4.3 Security observation

`AuthorityServiceURL` is **plain HTTP to a bare IP** (`http://34.246.94.215:8081`), and
`novaw deployapp` uploads our WASM to `/deploy/upload` over that channel. On testnet this
is presumably acceptable, but it means artifact upload has no transport integrity, and our
own deployment tooling should not treat anything returned by that endpoint as
authenticated. Worth raising with the team for mainnet; recorded here so it is a decision,
not an oversight.

---

## 5. B11 (new, CRITICAL) — deployment is permissioned

The reply states it plainly:

> For both the deployment is permissioned (only Horizen can deploy new apps).
> The only app installed on both for now is `vela-nova`.

Combined with the wallet README's `DEPLOYER_ROLE` requirement, the mechanism is now
precise. To deploy Noct Finance V1 we need **`DEPLOYER_ROLE` on `ProcessorEndpoint`
`0xd5E405a84753635608E7a28A59D7349BB2DAaEeF` (Base Sepolia) granted to an address we
control.**

**Why this is the top blocker:** Days 13 and 14 both say "Register the Vela application;
read the actual `velaApplicationID`". We cannot do that ourselves. No amount of local
engineering closes this — it requires a grant from Horizen, or them running
`novaw deployapp` on our behalf against our artifact.

**Consequences to absorb into the plan:**

- Day 13/14 must be re-scoped from "we deploy" to "we hand over a verified artifact and a
  deploy request, and consume whatever `ApplicationID` comes back".
- File 31 assertion 5 (never assume `velaApplicationID`) becomes *more* important, not
  less: the ID will arrive out-of-band from a third party.
- Our hardened deploy scripts cannot succeed against testnet regardless of correctness.
  They should stay fail-closed, and gain an explicit check that refuses to run when
  `DEPLOYER_ROLE` is absent, so the failure message names the real cause instead of
  surfacing as an opaque revert.
- The root commit's retracted claim of "Application ID: 2397975349340933566" matches
  **neither** real instance ID (`17812598362091411873` L3, `11579806367557720661` Base).
  That independently confirms the retraction was correct — no such app exists.

**Ask to send back, concretely:** grant `DEPLOYER_ROLE` on the Base Sepolia
`ProcessorEndpoint` to `<our address>`, or deploy our artifact for us and return the
assigned `ApplicationID`. Include the artifact SHA-256 so they deploy exactly what we
verified.

---

## 6. Unrequested but valuable: the gasless facilitator

Not mentioned in the reply text, but published on the status page. This is a **complete
client integration surface** and partially pre-empts what parts 2/3 were expected to cover.

- Repo: `https://github.com/HorizenOfficial/vela-facilitator`
- Public wallet: `0xd028cC273cC9A512ed074C7139d813f002e52D06`
- x402 scheme: `private-vela-fixed`; Nova `applicationId`: `11579806367557720661`
- Submits via `ProcessorEndpoint.submitRequestFor()` and pays gas on the user's behalf

| Endpoint | Purpose |
|---|---|
| `GET /` | Service info and endpoint directory (`Accept: application/json` for machine-readable) |
| `POST /submit` | Application-agnostic gasless submission — **ASSOCIATEKEY and PROCESS only** |
| `POST /claim` | Permissionless claim of pending balances; always pays `payee`, so no auth risk |
| `GET /supported` | x402 supported schemes and networks |
| `POST /verify` | x402 off-chain payment verification; no transaction sent |
| `POST /settle` | x402 on-chain settlement; blocks until the TEE emits the matching `AppEvent` |

### 6.1 `/submit` request shape (VERIFIED from the status page)

An **EIP-712 `RequestAuthorization`** signed by the user. The nonce is read from
`facilitatorNonces[sender]` **on-chain** by the client before signing — there is no nonce
endpoint.

| Field | Notes |
|---|---|
| `protocolVersion` | currently `0` |
| `applicationId` | target application ID |
| `requestType` | **`1` = PROCESS, `3` = ASSOCIATEKEY** — only these two are accepted |
| `payload` | ASSOCIATEKEY: raw **133-byte P-521 pubkey** (`0x04 ‖ x ‖ y`). PROCESS: ECIES-encrypted `PayloadInstructions`, app-specific |
| `tokenAddress` | ERC-20, or `address(0)` when `assetAmount = 0` |
| `assetAmount` | base units, as a **string** |
| `deadline` | Unix timestamp after which the signature is rejected |
| `requestSignature` | EIP-712 `RequestAuthorization` signature (hex) |
| `depositPermit` | **EIP-2612 permit `{v,r,s}`** when `assetAmount > 0`, else `null` |

```json
{ "sender": "0xUSER", "protocolVersion": 0, "applicationId": 1, "requestType": 3,
  "payload": "0x04...133bytes",
  "tokenAddress": "0x0000000000000000000000000000000000000000", "assetAmount": "0",
  "deadline": "1711929600", "requestSignature": "0x...", "depositPermit": null }
```

### 6.2 What this confirms about our architecture

- **P-521 is correct**, and the encoding is pinned: `0x04 ‖ x ‖ y`, exactly 133 bytes. Our
  File 16 P-521 assumption is now confirmed by a third party rather than inferred.
- **Deposits use EIP-2612 `permit`**, not a prior `approve`. Our custody ingress design
  must produce `{v,r,s}` — worth checking the architecture docs say so explicitly.
- `RequestCompleted` is not the only signal: `/settle` polls for a matching **`AppEvent`**
  with `eventSubType = keccak256(len(invoiceId) ‖ invoiceId ‖ sender ‖ token ‖ amount ‖
  recipient)`. Our guest must emit `AppEvent`s in that shape if we ever want x402
  settlement.
- Two tunables exist server-side: `APP_EVENT_POLL_INTERVAL_MS`, `APP_EVENT_POLL_TIMEOUT_MS`.

### 6.3 Canonical repository list (VERIFIED from status page)

| Purpose | Repo |
|---|---|
| Developer starter kit | `HorizenOfficial/vela-starterkit` ← **our existing submodule, correctly chosen** |
| Main repository | `HorizenOfficial/vela` |
| Client TypeScript library | `HorizenOfficial/vela-common-ts` |
| Common Go library | `HorizenOfficial/vela-common-go` ← we pin `v0.2.0` |
| Facilitator | `HorizenOfficial/vela-facilitator` |

Our `noct-vela-demo` submodule already points at `vela-starterkit`, which the team
themselves list as *the* developer starter kit. That choice is now confirmed correct.

---

## 7. Still open after part 1

| # | Question | State | Path to closure |
|---|---|---|---|
| **B11** | `DEPLOYER_ROLE` grant | ⛔ **CRITICAL, now fully characterised** | Role hash and current holder proven (§8.3). Needs Horizen's **admin** key, not their deployer |
| **B7** | Pyth `IPyth` on Base Sepolia | ⬜ **OPEN** | Largest remaining technical risk; untouched by part 1 |
| **B10** | USDC/USD feed ID | ⬜ **OPEN** | Untouched |
| **B3** | `TokenAllowlist` address | ✅ **CLOSED by us** | `0x8774E760B45a60a15B75770Fd7c60338006beEfa` (§8.1) |
| **B4** | `AuthorityRegistry` **contract** address | ✅ **CLOSED by us** | `0x754a26f68E3E4Fab1BD05FB6B227bedEC2e732d3` — a contract does exist (§8.1) |
| **B5** | `resetOperator` non-zero? | ✅ **CLOSED — premise was wrong** | It is a *role*, not an address (§8.2) |
| **B6** | USDC allowlisted? | ✅ **CLOSED by us** | Yes. tZEN is **not** (§8.1, §8.8) |
| **B12 (new)** | tZEN not on the allowlist | ⛔ | Blocks the two-asset Day 6 design (§8.8) |

**Method note — this worked, so keep doing it.** Four blockers that were waiting on a human
reply were closed in one session by reading the deployed contract and querying the subgraph.
B7 and B10 remain genuinely external (they depend on Pyth, not Vela), and B11/B12 genuinely
require Horizen action. Everything else should be probed before it is asked.

Reproduce all of §8 read-only with:

```bash
cd deploy-scripts && node verify-vela-testnet.js   # exit 0 = still matches, 2 = drift
```

### Questions to send back with parts 2/3

- **B11:** grant `DEPLOYER_ROLE`
  (`0xfc425f2263d0df187444b70e47283d622c70181c5baebb1306a01edba1ce184c`) on Base Sepolia
  `ProcessorEndpoint` to a specified address of ours — or deploy our artifact and return the
  assigned `ApplicationID`. Note your deployer `0x2eaaf2…aacb8` does **not** hold
  `DEFAULT_ADMIN_ROLE`, so this needs whoever holds the admin key.
- **B12:** add tZEN `0x107fdE93838e3404934877935993782F977324BB` to the allowlist, or
  confirm we should ship USDC-only for testnet.
- **B7 / B10:** the oracle path on Base Sepolia — still the largest open risk.
- Confirm `OnChainRefund` (not `OnChainRefound`), and note your reply named 3 events where
  the subgraph schema has 11 entities (§8.7).
- Your reply says only `vela-nova` is installed; the subgraph shows a second app
  `4474814306369175243` (§8.4). Is that expected?
- Whether the plaintext-HTTP `AuthorityServiceURL` is intended for mainnet (§4.3).

### Next actions needing no further input from Horizen

1. Download `novaw-linux` and `payment_app.wasm`; verify both against the SHA-256 digests
   in §3 and record the results here.
2. Inspect `payment_app.wasm`'s import/export tables against our `noct-demo.wasm` to derive
   the WASM envelope empirically.
3. Build `novaw` from source with pinned Go `1.24.0` as the B8 fallback.
4. Rewrite the indexer/assertion layer against the **subgraph**, not contract getters — the
   getters do not exist (§8.6).
5. Delete or repair `deploy-scripts/check-app-state.js`, whose ABI is proven absent (§8.6).


## 8. Self-verification against the live contract (2026-09-28)

Part 1 left B3, B4, B5 and B6 open. Rather than wait for parts 2/3, they were answered
directly from the deployed `ProcessorEndpoint` and the Goldsky subgraph. All read-only
(`eth_call` + GraphQL) — no key, no transaction, no gas.

Reproduce with `cd deploy-scripts && node verify-vela-testnet.js` (exit 0 = matches, 2 = drift).

### 8.1 Blockers closed

| # | Answer | How |
|---|---|---|
| **B3** | `TokenAllowlist` = `0x8774E760B45a60a15B75770Fd7c60338006beEfa` | `ProcessorEndpoint.tokenAllowlist()`; 2,096 bytes of code — a real contract |
| **B4** | `AuthorityRegistry` = `0x754a26f68E3E4Fab1BD05FB6B227bedEC2e732d3` | `ProcessorEndpoint.authorityRegistry()`; 1,124 bytes. **A contract does exist** — the reply's HTTP URL is a service in front of it, not a substitute |
| **B6** | **USDC IS allowlisted. tZEN is NOT.** | Subgraph `tokenAlloweds` returns exactly one entity, `0x036cbd53842c5426634e7929541ec2318f3dcf7e` (block 43,658,026) — a case-insensitive match for our verified USDC |
| **B5** | **Premise was wrong** — see §8.2 | `resetOperator()` does not exist; `RESET_OPERATOR()` does, and returns a role hash |

### 8.2 B5's premise was wrong

The roadmap asked "is testnet `resetOperator` non-zero?", assuming a single address. There is
no `resetOperator()` accessor. What exists is **`RESET_OPERATOR()`**, returning an
AccessControl **role hash**:

```
RESET_OPERATOR() = 0xc580ee26c87bb95870d138607be6d8598a348af3608b6ce0cef58e73a4c95917
```

So the real question is *who holds that role* — and it is the same Horizen address that holds
`DEPLOYER_ROLE` (§8.3). B5 is closed, but not as framed. The distinction matters: a design
expecting one resettable operator *address* would have been built wrong.

### 8.3 B11 is now fully characterised

Role hashes confirmed on the live contract:

| Role | Hash |
|---|---|
| `DEPLOYER_ROLE` | `0xfc425f2263d0df187444b70e47283d622c70181c5baebb1306a01edba1ce184c` |
| `RESET_OPERATOR` | `0xc580ee26c87bb95870d138607be6d8598a348af3608b6ce0cef58e73a4c95917` |
| `DEFAULT_ADMIN_ROLE` | `0x0000…0000` (standard OpenZeppelin) |

The subgraph's `deployRequestSubmitteds` names the deployer:
**`0x2eaaf231ce583b7cd7ae02c03b8fe7a96f0aacb8`** — the same account that appears in the
status page's failed-withdrawal error (§4.1), i.e. Horizen's own ops account.

| `hasRole(…, 0x2eaaf2…aacb8)` | Result |
|---|---|
| `DEPLOYER_ROLE` | **true** |
| `RESET_OPERATOR` | **true** |
| `DEFAULT_ADMIN_ROLE` | **false** |

**The consequence that changes the ask:** Horizen's deployer is *not* the admin. Some other,
still-unknown address holds `DEFAULT_ADMIN_ROLE` and granted these roles. So B11 must go to
whoever controls the **admin** key — the deployer address cannot grant us anything itself.
The facilitator wallet `0xd028cC…2D06` holds neither `DEPLOYER_ROLE` nor admin.

### 8.4 The reply is incomplete: there are TWO apps, not one

> "The only app installed on both for now is `vela-nova`."

The subgraph shows **two** applications on Base Sepolia, both from the same sender:

| `applicationId` | `DeployRequestSubmitted` block | Note |
|---|---|---|
| `4474814306369175243` | 43,656,923 | **not mentioned in the reply** |
| `11579806367557720661` | 43,657,058 | `vela-nova`, per the reply and status page |

Both `DeployRequestCompleted` with `status=0, errorCode=0, errorMessage=""`. That also
disproves the state enum in `deploy-scripts/check-app-state.js`, which claims `0 = NotDeployed`
— here `0` is the *success* value on a completed deploy. That script's ABI does not exist
anyway (§8.6), so it cannot work at all.

### 8.5 The fabricated application ID is now disproven with evidence

`2397975349340933566` — hardcoded in `deploy-scripts/check-app-state.js` and retracted from
the root commit — returns **0 records** from `deployRequestCompleteds`. It is not an
application on this instance, and the total number of apps ever deployed is 2. The retraction
was correct, and is now backed by a query rather than by assertion.

### 8.6 Accessors proven NOT to exist

All reverted with no data on `ProcessorEndpoint`:
`getApplicationState(uint64)`, `getApplicationData(uint64)`, `applications(uint64)`,
`getApplication(uint64)`, `getApp(uint64)`, `appStates(uint64)`, `applicationStates(uint64)`,
`applications(uint256)`, `getApplicationState(uint256)`, `resetOperator()`, `operator()`,
`getResetOperator()`, `resetOperatorAddress()`, `resetter()`.

On `TokenAllowlist`, none of `isAllowed`, `isTokenAllowed`, `allowlist`, `allowed`,
`isSupported`, `supportsToken`, `tokens`, `isListed`, `whitelist`, `isTokenListed` (each
taking `(address)`) exists — its interface is still unknown; use the subgraph's `TokenAllowed`
entities instead. On `AuthorityRegistry`, `authorityCount()`, `getAuthorities()`,
`authorities(uint256)`, `isRegistered(bytes32)` and `version()` all fail too.

**Consequence:** application and allowlist state is observable **only** through the Goldsky
subgraph, not by calling the contracts. Any indexer or deployment assertion that assumed
contract getters must be rewritten against the subgraph.

### 8.7 Subgraph schema — the authoritative entity list

Introspection of the deployed subgraph returns exactly these entities:

`AppEvent`, `ClaimExecuted`, `DeployRequestCompleted`, `DeployRequestSubmitted`,
`OnChainRefund`, `OnChainWithdrawal`, `Query`, `RequestCompleted`, `RequestSubmitted`,
`TokenAllowed`, `TokenRemoved`, `UserEvent`

This **confirms the §4 correction**: the entity is `OnChainRefund`. `OnChainRefound` does not
appear anywhere in the schema. It also shows the reply's three-event list omitted
`DeployRequestSubmitted`, `DeployRequestCompleted`, `TokenAllowed`, `TokenRemoved`,
`AppEvent` and `UserEvent` — and `TokenAllowed` is precisely how B6 was answered.

Useful field shapes confirmed by introspection:

- `TokenAllowed { id: Bytes!, token: Bytes!, blockNumber: BigInt!, blockTimestamp: BigInt! }`
- `DeployRequestSubmitted { applicationId: BigInt!, requestId: Bytes!, sender: Bytes!, … }`
- `DeployRequestCompleted { applicationId: BigInt!, requestId: Bytes!, applicationFees: BigInt!, status: Int!, errorCode: Int!, errorMessage: String!, … }`

Note `applicationId` is a `BigInt` in the schema but the wallet config and facilitator
`/submit` treat it as a `uint64`. Our own bindings must be explicit about width, since
`17812598362091411873` (the L3 app) exceeds `int64` and would go negative if mishandled.

### 8.8 Design consequence: tZEN is not allowlisted

Our architecture assumes custody ingress for **USDC and tZEN** (Day 6). Only USDC is
allowlisted. So either tZEN must be added — which needs an allowlist admin role we neither
hold nor have identified — or Day 6 must be re-scoped to USDC-only with tZEN deferred.

This is recorded as **B12** because silently building a two-asset ingress path against a
one-asset allowlist would fail at the first tZEN deposit, and would look like our bug rather
than a missing grant. Raise it alongside B11.






---

## 9. Part 2 of the reply — Accelerator Masterclass answers (recorded 2026-09-28)

Part 2 arrived as answers to one Masterclass question plus fifteen from team metaMe. Every
source it cites was fetched and checked, and the load-bearing claims were then re-tested
against the live Base Sepolia contracts. **Most of the citations check out. Three of the
answers do not describe what is actually deployed**, and two of those change our architecture.

New tools added while verifying, all read-only (`eth_call` / `eth_getCode` only):

| Script | Purpose |
|---|---|
| `deploy-scripts/check-tee-authenticator.js` | Who owns the TEE identity, what PCR0 is, which branch is deployed |
| `deploy-scripts/inspect-selectors.js` | Recovers the real function surface from deployed bytecode |
| `deploy-scripts/check-processor-state.js` | Live protocol constants, app state roots, custody, queue depth |

### 9.1 Blocker scoreboard after part 2

| # | Before part 2 | After part 2 | Why |
|---|---|---|---|
| **B5** | ✅ closed, premise wrong | ✅ **closed again, now with their own doc** | `PROCESSOR_ENDPOINT_ADMIN_RESET.md` confirms `RESET_OPERATOR` is a role, granted only at init, and deliberately *not* admin-grantable afterwards |
| **B6** | ✅ USDC allowlisted | ✅ **confirmed from the contract** | `getAllowedTokens()` returns `[USDC]` — no longer resting on a subgraph query alone |
| **B9** | ✅ permissioned; "state not readable on-chain" | ⚠️ **partly retracted** | `applicationStateRoots(uint64)`, `appCustody`, `totalAppCustody`, `pendingClaims`, `triggerContracts`, `getDeployedAppIds`, `PROTOCOL_VERSION` **all exist and work**. §8.2/§8.6 were wrong |
| **B11** | ⛔ critical, needs admin grant | 🟡 **unblocked — a different path exists** | The intake form (§9.2). We do not need `DEPLOYER_ROLE` at all |
| **B12** | ⛔ tZEN not allowlisted | ⛔ **confirmed, and the ask is now correctly targeted** | Only `DEFAULT_ADMIN_ROLE` can allowlist (§9.8). Their deployer does not hold it |
| **B7 / B10** | ⬜ Pyth address + USDC/USD feed | ⬜ **untouched** | Part 2 never mentions oracles. Still the largest technical risk |
| **B13 (new)** | — | ⛔ **CRITICAL** | The live `TeeAuthenticator` performs **no attestation verification at all** (§9.3) |
| **B14 (new)** | — | ⛔ | Attestation can never bind to our app WASM; PCR0 is executor-only and instance-global (§9.5) |
| **B15 (new)** | — | ⛔ | No upgrade path: new WASM ⇒ new app ID ⇒ **locked funds are not migrated** (§9.6) |
| **B16 (new)** | — | 🟡 | Our guest withdraws ETH-only, so it cannot yet return a USDC deposit (§9.8) |
| **B17 (new)** | — | ⛔ | `RESET_OPERATOR` can sweep **all** custody from **all** apps in one transaction (§9.13) |
| **B18 (new)** | — | 🟡 | No execution or state-size guardrails; shared environment (§9.12) |

### 9.2 B11 is unblocked — but not the way we were asking

Part 1 left us asking for a `DEPLOYER_ROLE` grant. Part 2 answer 2 says deployment is
*performed by the Vela Engineering team on request*, via a **Vela Production Testnet
Deployment Intake** form: `https://tally.so/r/xXWL1v`.

Fetched and confirmed: the form is titled exactly that and is **7 pages**. Page 1 asks for
company/project name, project purpose, main use-cases, and *"How will a user interact with
the deployed WASM?"* with the note *"all of these must be deployed independently by you."*

The same answer also states:

- the environment is **shared** with the other apps;
- **no direct terminal access** to the environment is provided;
- Base Sepolia now, **Horizen testnet "soon"**.

**Consequence.** The B11 ask changes shape. We no longer need anyone to hand us a role — we
need to submit the intake form and receive an `ApplicationID` back. That is strictly better:
it removes a dependency on an unidentified admin key. Two things follow:

1. Roadmap Day 13's deliverable "register the Vela application" becomes "submit intake, then
   read the returned `ApplicationID` back from the chain" — assertion 5 gets *more* important,
   because the ID still arrives out-of-band from a third party.
2. Because there is no terminal access, **everything we planned to inspect inside the
   environment is unobtainable.** Any design that assumed we could read executor logs, query
   the manager, or inspect private state directly must be rebuilt on the subgraph plus
   `AppEvent` (§9.9) plus our own client-side observation.

Capacity is not the constraint: `availableDeploySlots()` returns **8**.

### 9.3 ⚠️ B13 (CRITICAL) — the live `TeeAuthenticator` verifies no attestation at all

Answer 3 says the attestation "is verified on-chain (see the contract code here
`contracts/contracts/TeeAuthenticator.sol`) ... uses the NitroProver contract ... and checks
the PCR0 measurement of the TEE". **That file was fetched and it does say this.** So does
`main`'s `TeeAuthenticator.sol`:

```solidity
INitroProver public immutable nitroProver;
bytes public pcr0;
uint256 public immutable maxVerificationAge;
function updateTee(bytes calldata attestation) external onlyOwner { ... }
function updateTeeStep1(bytes calldata attestation) external onlyOwner { ... }
function updatePcr0(bytes calldata newPcr0) external onlyOwner { ... }
```

**But that is not what is deployed at `0x69Ca935A17e3920B80DB71d723Aee918e1aE75E3`.**

`eth_call` is authoritative for public state-variable getters, and five of them revert with no
data on the live contract: `pcr0()`, `nitroProver()`, `maxVerificationAge()`,
`currentUpdateStep()`, `getStep2TotalLength()`. `inspect-selectors.js` then recovered the
complete dispatch table from the 3,697-byte runtime bytecode. There are **ten** selectors:

```
8da5cb5b  owner()                    715018a6  renounceOwnership()
f2fde38b  transferOwnership(address)  43f855c3  teeSigner()
fe4993ca  pubSecp521r1()             0dd7ce2f  getTeeSigner()
081bec7e  getPubSecp521r1()          c91496c6  PK_LENGTH()
c64af6fb  updateTee(address,bytes)   5c9626b9  (unidentified)
```

Note the shape of `updateTee`: **`(address, bytes)`**, not `(bytes attestation)`. It takes a
signer address and a public key *directly*. There is no `updateTee(bytes)`, no
`updateTeeStep1..4`, no `updatePcr0`, no `nitroProver`, no PCR comparison and no certificate
chain anywhere in the bytecode.

Alternative explanations were ruled out, not assumed away:

| Hypothesis | Test | Result |
|---|---|---|
| It is a proxy hiding the real logic | EIP-1967 implementation + admin slots | both `0x00…00`; no minimal-proxy pattern; contract contains its own `SSTORE` |
| My selector regex missed functions | direct `eth_call` on each getter | all five revert with no data — a public getter cannot revert if the storage exists |
| It is an older build of the same design | `main` vs `pc/tee_upgrade` compared | `IProcessorEndpoint.sol` is **byte-identical** (19,631 B) on both, so the branches agree everywhere *except* `TeeAuthenticator` |
| Basescan would show verified source | `getsourcecode` API | `status=0 NOTOK` — **unverified** |

`PK_LENGTH()` returns **133** = `0x04 ‖ X(66) ‖ Y(66)`, an uncompressed P-521 point, and
`pubSecp521r1()` holds a real 133-byte key, so the *data model* is genuine. What is missing is
the *proof*.

**What this means.** On Base Sepolia the TEE signing key is whatever the owner last set. The
current values are `teeSigner = 0xC21F4E4ECD18aF70cD4FCd263F4dc196eb7D3625` and a 133-byte
P-521 key. Nothing on-chain certifies that either corresponds to code running in a Nitro
enclave. Every `stateUpdate` we accept is signed by a key that a single EOA can replace at
will, with no attestation, no delay and no on-chain record of *why*.

This does **not** mean Vela has no attestation — `main` clearly implements it, and
`REPRODUCIBLE_EIF_BUILD.md` describes a rigorous reproducible-PCR0 process. It means **the
shared testnet we have been told to build on does not have it turned on.** So:

- Day 14's testnet launch demonstrates request/response plumbing and custody accounting.
  It demonstrates **nothing** about the TEE trust model. The roadmap already says this about
  ZK; it must now say it about attestation too.
- The Masterclass answer to *"can we check the proof ourselves?"* — "Not possible ... must be
  verified using our TeeAuthenticator" — is true of `main`, but on this instance there is
  **no proof to check**, on-chain or off.
- Any public claim that Noct runs in an attested Nitro enclave is **unsupportable on Base
  Sepolia** and must be scoped to a future environment where `pcr0`/`nitroProver` are present.
  Re-run `check-tee-authenticator.js` before making it.
### 9.4 Q15 answered from the chain, not from the reply

Answer 15 says the TEE upgrade procedure "is currently in the design phase ... any
implementation has been started yet", pointing at `pc/tee_upgrade`'s
`EXECUTOR_TEE_UPGRADE_DESIGN.md`. That branch and document **do exist** (verified; the
directory also holds `APP_EVENT.md`, `BATCH_EXECUTION.md`,
`ERC20_DEPOSITS_WITHDRAWALS_DESIGN.md`, `EXECUTOR_TEE_UPGRADE_TASKS.md`,
`EXEC_MGR_HANDSHAKE.md`, `FACILITATOR.md`, `PROCESSOR_ENDPOINT_ADMIN_RESET.md`,
`REPRODUCIBLE_EIF_BUILD.md`, `UPGRADABLE_CONTRACTS_DESIGN.md`). But the sub-questions have
concrete answers today:

| Q15 sub-question | Verified answer |
|---|---|
| Who controls `updatePCR0`? | On `main`: `TeeAuthenticator.owner()`. On Base Sepolia that function **does not exist** — `updateTee(address,bytes)` does instead, which is strictly more powerful |
| Who is that owner? | `0x2eaaf231Ce583B7cd7Ae02c03B8Fe7a96F0aaCb8` — **Horizen's deployer**, the same EOA holding `DEPLOYER_ROLE` and `RESET_OPERATOR` |
| Can ownership be a multisig? | Not enforced. `TeeAuthenticator` uses `Ownable`, not `AccessControl`. `getCode()` on the owner returns `0x` → a **plain EOA, one private key** |
| Can upgrades be timelocked? | **No.** `updatePcr0` in `main` is immediate. The timelock lives in `proposePcr0Swap`, in the *unmerged* design doc |
| Is historical PCR authorization retained? | No. `pcr0` is one overwritten `bytes` value; only the `PcrZeroUpdate(old,new)` event records history |
| Can we bind our app/version to a PCR0? | **No** — see §9.5 |
| Can a compromised measurement be revoked? | Yes, by the owner, instantly — which is also why a compromised owner key is unrecoverable without them |

One address therefore controls TEE identity, app deployment **and** admin reset. It does
**not** hold `ProcessorEndpoint`'s `DEFAULT_ADMIN_ROLE` (`hasRole` returns `false`), so there
are at least three distinct privilege domains on this instance: the deployer EOA, an
unidentified `DEFAULT_ADMIN_ROLE` holder, and the TEE signer itself.

### 9.5 B14 — attestation can never bind to our application code

Even taking `main`'s real `TeeAuthenticator` at face value, the check is:

```solidity
if (pcrs.length < 4 + pcr0.length) revert InvalidPCR();
while (i != length) { if (pcrs[i + 4] != pcr0[i]) revert InvalidPCR(); ++i; }
```

Two structural facts follow, and both are confirmed by their own docs:

1. **Only PCR0 is compared.** `REPRODUCIBLE_EIF_BUILD.md` states PCR0 is "a SHA-384 over the
   **whole EIF**", assembled from the Go executor binary, the runtime image filesystem (the
   ramdisk) and `nitro-cli`'s packaging blobs. It is a measurement of **the Vela executor**.
2. **`pcr0` is one global value per instance**, not per application.

Our WASM is uploaded afterwards, over the plaintext-HTTP authority service (§4.3). It is
**not** in the EIF and therefore **not** in PCR0. Answer 3 half-says this — PCR0 refers "to a
specific Vela version" — but the architectural consequence is not spelled out anywhere in the
reply, and it is the one that matters to us:

> **Vela's attestation certifies the runtime, never the application.** There is no
> cryptographic binding between any Nitro attestation and the Noct guest binary. Our app's
> integrity rests entirely on the upload channel and on operator honesty.

Combined with §9.3 (nothing is attested on Base Sepolia at all) and answer 8's own caveat that
"Vela attests execution, not correctness", the honest statement of our trust model is:

| Claim | Supportable today? |
|---|---|
| "Noct's state transitions are produced inside an AWS Nitro enclave" | Only on an instance whose `TeeAuthenticator` exposes `pcr0`/`nitroProver` — **not** Base Sepolia |
| "The enclave runs a *known, published* Vela executor build" | Yes in principle: PCR0 is independently recomputable (see below), *if* they publish the tag + expected PCRs |
| "The enclave runs *our* audited WASM" | **No.** Never, by construction |
| "Vela guarantees our computations are correct" | **No.** Their words: attests execution, not correctness |

One genuinely useful thing came out of `REPRODUCIBLE_EIF_BUILD.md`: a third party **can**
recompute PCR0 — `git checkout <tag> && ./dockerfiles/executor/build-eif.sh <tag> ./eif-out`,
then compare `jq .Measurements.PCR0` against the on-chain value. It also warns that
**the EIF file hash is not reproducible** (nitro-cli stamps a wall-clock `BuildTime` into the
unmeasured header), so verification must gate on PCR0/1/2, never on an image hash. That
directly amends our plan to "hash-verify" enclave artifacts: the technique is right for
`novaw-linux` and `payment_app.wasm`, and wrong for any `.eif`.

There are also two image variants — **genesis** (`EXPECT_EXISTING_KEYSET=false`) and
**upgrade** — with *different PCR0s*. The genesis image bootstraps the keyset once and must
then be retired from the accepted set and the KMS policy. So a single pinned PCR0 is not
sufficient forever, and whoever controls the accepted set controls the enclave.

### 9.6 B15 — there is no upgrade path, and locked funds do not follow

Answer 4 is unambiguous and is the single most design-shaping statement in part 2:

> "No upgrade procedure is yet available in this early stage. In case of a new wasm version you
> will need to repeat the deployment procedure, and will obtain a fresh new application ID with
> a fresh new state. **Any locked funds on the old application will have to be unlocked
> manually and will not be migrated to the new application ID.**"

For a lending protocol this is not an inconvenience, it is a solvency question. A Noct
deployment holds user collateral in `appCustody[appId][token]`. Every WASM change therefore
requires: stop new deposits → let every position be repaid or liquidated → drain custody →
redeploy → re-onboard. Positions cannot be carried across, and the private state that tracks
them is discarded.

Concrete consequences for our architecture:

1. **File 06/31's upgrade and migration assumptions are void.** Nothing in the sprint may
   assume in-place WASM replacement. The `NoctTrigger` + `OracleAdapter` contracts we deploy
   ourselves are upgradeable by us, but the Vela app is not — and `triggerContracts[appId]`
   binds a trigger to one app ID, so a new app ID also needs re-registration via
   `submitDeployRequestWithTrigger`.
2. **Version churn is expensive, so the guest must be right the first time.** That raises the
   value of the guest test suite and of `payment_app.wasm` as a reference, and lowers the value
   of "ship and iterate".
3. **Day 6 must design for a clean drain.** A USDC-only fallback (§9.8) is not merely easier;
   it is the variant whose custody we can fully enumerate, because `getAllowedTokens()` tells
   us exactly which tokens to sweep.
4. **A kill switch is mandatory, not optional.** Since we cannot patch a live app, we need an
   off-ramp that does not depend on the WASM being correct. Our own `NoctTrigger` and the
   user-facing client are the only surfaces we control.
5. Note the interaction with §9.13: the *operator* has a one-call way to drain everything
   (`adminResetApps`). We have no equivalent for a single app. That asymmetry belongs in the
   incident runbook.

Answer 5 also resolves the multi-app contradiction answer 1 left open: **"multi-app with
per-app isolated state and per-app locked funds is implemented"**, and the repositories are
ground truth over the docs. Our own probe agrees — `getDeployedAppIds()` returns two IDs, and
`appCustody` is keyed `[appId][token]`. Isolation is real at the contract level. Whether it is
real inside the shared executor is a different question, and answer 11 says there are no
resource guardrails (§9.12).
### 9.7 Q9 — failure and replay semantics, now specified (and B9 partly retracted)

Answer 9 gives a mechanism we can actually test against:

- **Reorg handling.** An overall state root is recorded on-chain and re-checked every round
  against the off-chain private state. On mismatch the private state is rolled back to a
  version compatible with the on-chain root (it is kept in a versioned format) and execution
  restarts from there.
- **Idempotency.** Every request gets a unique id on entering the contract queue.

The on-chain half of that is now visible. `IProcessorEndpoint.sol` exposes:

```solidity
function generateRequestId(address sender, uint64 applicationId, Structs.RequestType requestType,
                           bytes32 payloadHash, address tokenAddress, uint256 assetAmount,
                           uint256 idx) external pure returns (bytes32);
function applicationStateRoots(uint64) external view returns (bytes32);
function getNextPendingRequest() external view returns (Structs.PendingRequest memory, bytes32, bool);
function isCurrentPendingRequest(bytes32) external view returns (bool);
function getPendingRequestsSize() external view returns (uint256);
```

So `requestId` is **deterministic**, derived from sender, app, type, payload hash, token,
amount and the queue index `idx`. Two useful consequences:

- We can compute the expected `requestId` client-side *before* submitting — exactly the
  idempotency handle Day 10's replay protection needs. An identical request at the same queue
  index yields the same id.
- **The canonical state is `applicationStateRoots(appId)`.** Monitoring can detect a manager
  rollback by watching that value change without a corresponding `stateUpdate`. At probe time
  it was `0xf94034604b7cf0e87d7d480c7bcbaa148b14cf680deafd983305da2abc6647d4` for `vela-nova`
  and `0x967773e5fa67f01fa626051e33b4da256bcb8c8fee30a2aaef7f292b9870b2d5` for app
  `4474814306369175243`.

> **Retraction.** §8.2/§8.6 and blocker B9 recorded that application state "is NOT readable
> from the ProcessorEndpoint contract". That was an artefact of trying invented accessor names
> (`getApplicationState`, `applications`, `appStates`, `getApp`, ...). The real accessors exist
> and work: `applicationStateRoots(uint64)` `7a36a891`, `appCustody(uint64,address)` `b7222ff5`,
> `totalAppCustody(address)` `af20c960`, `pendingClaims(address,address)` `840059ec`,
> `totalPendingClaims(address)` `194b6be8`, `claim(address,address)` `21c0b342`,
> `triggerContracts(uint64)` `1cc76c38`, `getDeployedAppIds()` `7596ed43`,
> `PROTOCOL_VERSION()` `aa3aa460`. `check-app-state.js`'s header is corrected and
> `check-processor-state.js` reads the real surface.
>
> The subgraph is still the right source for *history* — who submitted what, when, and how it
> completed — because the contract keeps only the current queue head. **Chain for current
> state, subgraph for history.** The earlier "use the subgraph, not the getters" instruction is
> too strong and is hereby narrowed.
### 9.8 Q12 / B6 / B12 / B16 — ERC-20 reality, and a gap in our own guest

Answer 12 says keep the kernel asset-agnostic, and lists `TokenAllowlist` plus the EIP-712 +
EIP-2612 facilitator path. `ERC20_DEPOSITS_WITHDRAWALS_DESIGN.md` supplies the constraints
that actually bind us:

| Fact | Consequence for Noct |
|---|---|
| **Fees are ETH-only**, explicitly a non-goal for ERC-20 | A USDC depositor must still hold ETH for `maxFeeValue` *and* gas. "USDC-only onboarding" is impossible — it is USDC-asset / ETH-fee |
| ETH: `msg.value == assetAmount + maxFeeValue`. ERC-20: `msg.value == maxFeeValue` exactly, asset via `transferFrom` | Our client must branch on `tokenAddress`. `submit-transaction.js` now documents this |
| `assetAmount == 0` ⇒ `tokenAddress` must be `0x0` | Zero-value probes must use the zero address |
| **Only `DEFAULT_ADMIN_ROLE` adds/removes allowlist tokens** | B12's ask must target the admin, not the deployer — and the deployer provably is not the admin (§9.4) |
| Removal blocks new deposits but **not** claims or queued requests | A token can be delisted without stranding funds mid-flight; worth mirroring in our own risk parameters |
| **No per-app on-chain allowlist** (R3): "Each WASM application manages its own supported-token configuration at runtime" | **This is the real answer to Q12's asset-agnostic ask.** Token policy is *ours*, enforced in the guest. Unsupported token ⇒ our WASM rejects ⇒ the failed-request path refunds |
| Non-standard tokens are a non-goal: no fee-on-transfer, no rebasing | tZEN must be checked for both *before* we ask for it to be allowlisted |
| Guest ABI is `deposit(appId, sender, tokenAddress, amount, state)` plus a `deploy(appId, params)` export | Our `DepositFunds(appId, sender, token, amount, stateJSON)` and `Deploy(appId, paramsJSON)` **already match** |

**B16 — a gap in our own code, found while checking the above.** `vela-common-go v0.2.0` is
our pin *and* the latest published tag (there is no v0.3.0), and it is fully token-aware:

```go
type Withdrawal struct {
    TokenAddress       Address  `json:"tokenAddress"`
    DestinationAddress Address  `json:"destinationAddress"`
    Amount             *Uint256 `json:"amount"`
}
type AppEvent struct { EventSubType [32]byte `json:"eventSubType"`; Data []byte `json:"data"` }
```

So the dependency-version mismatch we feared **does not exist** — and `EventSubType` is already
the corrected `[32]byte` form that `APP_EVENT.md` warns about (an earlier version returned
`"0x"+hex` strings silently truncated to 32 ASCII characters, losing ~17 bytes of entropy).
But `app/lending.go` hardcodes `TokenAddress: zeroAddress` in both the borrow and the withdraw
instructions, and `ProcessWithdraw` takes no token parameter. **Our guest can accept a USDC
deposit and can only ever return ETH.** For a USDC-funded app that is a custody accounting bug:
the contract holds USDC while we instruct an ETH withdrawal. The `stateUpdate` solvency check
should reject it, but relying on a revert to catch a design error is not a plan.
`ProcessDeposit` and `ProcessRepay` already take a `token` argument, so the fix is to thread it
through state and emit it on withdrawal — Day 6 work, not Day 13.

One more observation: `vela-nova` holds **0.05 USDC** in `appCustody`, equal to the whole
instance's `totalAppCustody(USDC)`. Their own task list says nova should "keep ETH-only
behavior: reject non-zero `tokenAddress` in deposit". Either the deployed nova is not ETH-only
or the USDC arrived another way. Either way the ERC-20 deposit path **has** been exercised on
Base Sepolia — reassuring, though at 0.05 USDC not evidence it has been exercised *hard*.
`totalPendingClaims(USDC)` is 0.1, twice the remaining custody, consistent with withdrawals
moving value from `appCustody` into `pendingClaims`.
### 9.9 Q14 correction — there *is* a plaintext event channel, and it is live

Answer 14 says "The wasm logic can only emit withdrawals or events. However events can contain
an arbitrary payload (**it will be encrypted with the receiver P521 key**)". That is only half
true, and the missing half is the more useful one. `APP_EVENT.md` defines **two** event kinds:

| | `UserEvent` | `AppEvent` |
|---|---|---|
| Directed at | one user (`userId`) | nobody — application-level |
| Payload | `encryptedData`, encrypted to the receiver's P-521 key | **`data`, explicitly *not* encrypted by the executor** |
| Subtype | `bytes32 indexed eventSubType` | `bytes32 indexed eventSubType` |
| Emitted from | `ProcessRequest`, `DepositFunds` | `ProcessRequest`, `DepositFunds` |

```solidity
event AppEvent(uint64 indexed applicationId, bytes32 indexed requestId,
               bytes32 indexed eventSubType, bytes data);
```

`eventSubType` is stored **as-is in log topics, unhashed**, so ASCII tags ≤32 bytes are directly
readable; longer messages go in `data` with a hash in the topic. The subtype encoding is
**per-application policy** — the framework deliberately provides no helper. `SimpleApp` and
`TriggerApp` pack ASCII left-aligned via their own `subtype.FromString`; keccak256 or enumerated
constants are equally valid; and `pkg/executor/subtype.go` derives *anti-linkability* subtypes
from a user seed via HMAC-SHA256 (paired with `SUBTYPE_KEY_MESSAGE = "subtype-key-v1"` and
`DEFAULT_SUBTYPE_N = 50` in `vela-common-ts`).

**Verified live, not just documented.** Because this doc sits on `pc/tee_upgrade` it could have
been unmerged, so it was checked two ways:

- `stateUpdate` on the deployed `ProcessorEndpoint` is the 12-argument form taking
  `(bytes[],bytes32[])` `EventData` tuples for **both** user and app events — selector
  `8537c278`, present in the bytecode.
- The live Goldsky subgraph's introspected schema includes an **`AppEvent`** entity, alongside
  `UserEvent`, `ClaimExecuted`, `OnChainRefund`, `OnChainWithdrawal`, `TokenAllowed`,
  `TokenRemoved`, `RequestSubmitted/Completed` and `DeployRequestSubmitted/Completed` — the 11
  entities of §8.7.

So `AppEvent` **is available to us on Base Sepolia today.** That is the real answer to Q14's
"can we calibrate what metadata is emitted, and give us the schema": yes — emit `AppEvent` with
a chosen `bytes32` subtype and whatever plaintext `data` we want, and it is publicly indexed.

Three constraints to design around:

1. `events.length == subTypes.length`, else `revert InvalidPayload()`.
2. When `errorCode != NO_ERROR`, **both** event arrays must be empty — an error path cannot
   carry a diagnostic event, so diagnostics must go in `errorMsg`.
3. Ordering is by array index on-chain, and by `logIndex`/`sortKey` in the subgraph.

**Direct consequence for us.** `app/operations.go` sets `AppEvents: []types.AppEvent{}` on
*every* return path — we emit none. Since there is no terminal access (§9.2), `AppEvent` is our
**only** public telemetry channel out of the enclave. Day 12's indexer/dashboard and Day 14's
monitoring should be built on it: reserve a subtype namespace (e.g. `noct.liquidation`,
`noct.oracle.update`, `noct.health`) and emit non-secret aggregates there, keeping anything
secret in `UserEvent`. §8.7's entity list should accordingly be treated as our monitoring
contract.
<!-- SEC_9_10 -->







