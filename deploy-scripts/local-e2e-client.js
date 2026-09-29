// Full end-to-end exercise of the NoctFinance guest on the LOCAL docker Vela stack,
// driven through the official @horizen/vela-common-ts client (v0.2.0).
//
// Why this exists: submitting `submitRequest` by hand with a plaintext payload fails
// with error code 9 (PUBKEY_NOT_REGISTERED). The runtime requires each sender to first
// register a P-521 communication key via an ASSOCIATEKEY request, and thereafter every
// PROCESS payload must be ECDH-encrypted to the TEE's public key. The official client
// implements both, so we use it rather than reimplementing the crypto.
//
// Targets the emulated-TEE stack in noct-vela-demo/dockerfiles (Anvil chain 31337,
// TEE_NO_ATTESTATION=true). Asserts chainId 31337 and refuses to run anywhere else.
//
// Prerequisite: upload the artifact to the authority service first --
//   curl -X POST http://localhost:8081/deploy/upload -F "wasm=@noct-demo-wasm/noct-demo.wasm"
//
// Usage:
//   node local-e2e-client.js deploy
//   node local-e2e-client.js run <appId>

import { ethers } from 'ethers';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  VelaClient, RequestType, ETH_TOKEN, PROTOCOL_VERSION,
  buildAssociateKeyPayload, exportPublicKeyToHex, hexToBytes,
  stringToBytes, bytesToString,
} from '@horizen/vela-common-ts';

const RPC_URL = process.env.VELA_RPC_URL || 'http://localhost:8545';
const EXPECTED_CHAIN_ID = 31337n;
const PROCESSOR = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
const TEE_AUTHENTICATOR = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';

// Anvil account #0, published in the starter kit's .env.dev. Holds DEPLOYER_ROLE and
// admin on the LOCAL chain only; no value and no authority on any real network.
const DEPLOYER_KEY = process.env.VELA_DEPLOYER_PRIVATE_KEY
  || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const MAX_FEE = 1000000n;
const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', 'noct-demo-wasm', 'noct-demo.wasm');

function fatal(...lines) { for (const l of lines) console.error(l); process.exit(1); }
const hr = (s) => console.log(`\n=== ${s} ===`);

async function connect() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const chainId = (await provider.getNetwork()).chainId;
  if (chainId !== EXPECTED_CHAIN_ID) {
    fatal(`FATAL: chainId ${chainId}, expected ${EXPECTED_CHAIN_ID} (local Anvil).`);
  }
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);
  const client = new VelaClient(wallet, false, TEE_AUTHENTICATOR, PROCESSOR);
  return { provider, wallet, client };
}

// Reads the request outcome the TEE signed. errorCode 0 means the guest ran and its
// state was committed; anything else means the request was rejected or rolled back.
async function outcome(client, provider, requestId, fromBlock) {
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const head = await provider.getBlockNumber();
    const res = await client.getRequestCompletedEvent(requestId, head, fromBlock);
    if (res) return res;
  }
  return undefined;
}

function report(label, res) {
  if (!res) { console.log(`${label}: TIMED OUT (no RequestCompleted event)`); return false; }
  const ec = res.errorCode === undefined ? 'none' : res.errorCode.toString();
  console.log(`${label}: status=${res.status} errorCode=${ec}${res.errorMessage ? ' msg=' + res.errorMessage : ''}`);
  return ec === '0' || ec === 'none';
}

async function doDeploy() {
  const { provider, wallet, client } = await connect();
  const wasmBytes = readFileSync(wasmPath);
  const hash = createHash('sha256').update(wasmBytes).digest('hex');

  hr('DEPLOY');
  console.log('deployer   :', wallet.address);
  console.log('artifact   :', wasmBytes.length, 'bytes');
  console.log('sha256     :', hash);

  const fromBlock = await provider.getBlockNumber();
  // The client builds the artifact_ref descriptor itself from the raw sha256 digest.
  const receipt = await client.submitDeployRequestAndWaitForRequestId(
    PROTOCOL_VERSION, MAX_FEE, hexToBytes(hash),
    { collateral_ratio: 200, protocol_version: 'v1.0.0' },
  );
  console.log('requestId  :', receipt.requestId);
  console.log('tx         :', receipt.transactionReceipt.hash);

  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const head = await provider.getBlockNumber();
    const res = await client.getDeployRequestCompletedEvent(
      undefined, receipt.requestId, head, fromBlock);
    if (res) {
      report('deploy', res);
      console.log('APPLICATION ID:', res.applicationId.toString());
      return;
    }
  }
  console.log('timed out waiting for DeployRequestCompleted.');
}

async function doRun(appIdStr) {
  if (!appIdStr) fatal('usage: node local-e2e-client.js run <appId>');
  const appId = BigInt(appIdStr);
  const { provider, wallet, client } = await connect();

  console.log('sender        :', wallet.address);
  console.log('applicationId :', appId.toString());
  console.log('TEE pubkey    :', (await client.getTeePublicKey()).slice(0, 42) + '...');

  // --- Step 1: ASSOCIATEKEY. Without this, every PROCESS request fails with code 9.
  hr('STEP 1: ASSOCIATEKEY (register P-521 comms key)');
  const keyPair = await client.getSignerKeyPair();
  const pubHex = await exportPublicKeyToHex(keyPair.publicKey);
  console.log('P-521 pubkey  :', pubHex.slice(0, 34) + '...', `(${hexToBytes(pubHex).length} bytes)`);

  let fromBlock = await provider.getBlockNumber();
  const akPayload = buildAssociateKeyPayload(keyPair.publicKey, undefined);
  const akBytes = akPayload instanceof Promise ? await akPayload : akPayload;
  const ak = await client.submitRequestAndWaitForRequestId(
    PROTOCOL_VERSION, appId, RequestType.ASSOCIATEKEY,
    akBytes, ETH_TOKEN, 0n, MAX_FEE);
  console.log('requestId     :', ak.requestId);
  if (!report('associatekey', await outcome(client, provider, ak.requestId, fromBlock))) {
    fatal('ASSOCIATEKEY failed; PROCESS requests cannot succeed without it.');
  }

  // --- Step 2..N: the actual lending flow. Payloads are encrypted to the TEE.
  // Operation names and the hex `amount` field come from app/lending.go.
  const ONE_ETH = 10n ** 18n;
  const steps = [
    { label: 'DEPOSIT 1 ETH', op: 'DEPOSIT', amount: ONE_ETH, asset: ONE_ETH },
    { label: 'VIEW_BALANCE', op: 'VIEW_BALANCE', amount: 0n, asset: 0n },
    // 200% collateral ratio against 1 ETH => 0.5 ETH is the maximum borrow.
    { label: 'BORROW 0.4 ETH (within 200% ratio)', op: 'BORROW', amount: 4n * 10n ** 17n, asset: 0n },
    { label: 'BORROW 0.5 ETH (MUST be rejected)', op: 'BORROW', amount: 5n * 10n ** 17n, asset: 0n, expectFail: true },
    { label: 'REPAY 0.4 ETH', op: 'REPAY', amount: 4n * 10n ** 17n, asset: 0n },
    { label: 'WITHDRAW 1 ETH', op: 'WITHDRAW', amount: ONE_ETH, asset: 0n },
  ];

  const results = [];
  for (const s of steps) {
    hr(`STEP: ${s.label}`);
    const payload = JSON.stringify({ operation: s.op, amount: '0x' + s.amount.toString(16) });
    console.log('payload       :', payload);
    const encrypted = await client.encryptForTee(stringToBytes(payload));

    fromBlock = await provider.getBlockNumber();
    const rr = await client.submitRequestAndWaitForRequestId(
      PROTOCOL_VERSION, appId, RequestType.PROCESS,
      encrypted, ETH_TOKEN, s.asset, MAX_FEE);
    console.log('requestId     :', rr.requestId);

    const res = await outcome(client, provider, rr.requestId, fromBlock);
    const ok = report(s.label, res);
    results.push({ step: s.label, ok, expectFail: !!s.expectFail });

    // Pull back whatever the guest emitted for this sender on this request.
    try {
      const head = await provider.getBlockNumber();
      const evs = await client.getCurrentUserEvents(
        head, fromBlock, appId, rr.requestId, undefined, () => true, false);
      for (const e of evs) console.log('  guest event :', bytesToString(e));
    } catch (e) {
      console.log('  (event read failed:', (e.shortMessage || e.message).slice(0, 80) + ')');
    }
  }

  hr('SUMMARY');
  let pass = 0;
  for (const r of results) {
    // The under-collateralized borrow is supposed to be refused; treat refusal as a pass.
    const good = r.expectFail ? !r.ok : r.ok;
    if (good) pass++;
    console.log(`  ${good ? 'PASS' : 'FAIL'}  ${r.step}${r.expectFail ? '  (expected rejection)' : ''}`);
  }
  console.log(`\n${pass}/${results.length} steps behaved as expected.`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'deploy') await doDeploy();
else if (cmd === 'run') await doRun(rest[0]);
else fatal('usage: node local-e2e-client.js deploy | run <appId>');
