# 7. Noct Account / Identity Model

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.


## Goal

Separate public wallet identity from private Noct position identity.

## Vela client interaction

The current Vela TypeScript client derives a P-521 communication key from wallet signing material and uses it for encrypted communication and encrypted user events. Reuse that client flow.

## Conceptual model

```text
wallet signer
   ↓
Vela communication key
   ↓
Noct account identity
   ↓
position commitment
   ↓
private account state
```

## Account state

```text
Account {
  accountCommitment
  positionCommitment
  nonce
  status
}
```

## Initialization

1. Connect wallet.
2. Derive Vela communication key.
3. Register/associate the key as required by Vela.
4. Initialize private Noct account.
5. Create initial zero-state commitment.

## Storage rule

Do not put raw private keys or seed phrases in localStorage. Use wallet signing and Vela's documented Web Crypto/key derivation flow.
