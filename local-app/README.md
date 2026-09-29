# NoctFinance local prototype

This is a browser prototype for the NoctFinance lending flow. It has two local modes:

- **Demo wallet**: works immediately without MetaMask, funds, Docker, or a testnet. State is persisted in `localStorage` and applies the same 200% collateral rule as `noct-demo-wasm/app/lending.go`.
- **Injected wallet**: connects through any EIP-1193 provider (MetaMask, Rabby, etc.). The wallet address is used as the account identity while the browser simulator keeps the local protocol state.

## Run it

From the repository root:

```powershell
npm start
```

You can also run `cd local-app; npm start`.

Open <http://127.0.0.1:4173> (the app is on **4173**, not `8545`), then select **Use demo wallet** or **Connect wallet**. Port `8545` is reserved for the Anvil/Vela JSON-RPC endpoint and will not render a webpage. The UI supports deposit, borrow, repay, withdraw, balance, protocol totals, health, and recent transaction state.

## Validate the real local Vela guest

The existing Docker stack and encrypted client remain the source of truth for WASM execution. Start the stack from `noct-vela-demo/dockerfiles`, upload/deploy the artifact using the existing scripts, then check its RPC:

```powershell
node local-app/validate-vela.mjs
node local-app/validate-vela.mjs --app-id <deployed-application-id>
```

The second command delegates to `deploy-scripts/local-e2e-client.js`, which performs the associate-key flow and encrypted deposit/borrow/repay/withdraw sequence. The local browser simulator is deliberately independent so the product can be exercised when Docker or a wallet is unavailable.

## Tests

```powershell
cd local-app
npm test
```

The tests cover the complete healthy lending flow, the 200% collateralization boundary, and invalid repayment/withdrawal cases.
