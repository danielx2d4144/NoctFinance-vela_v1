// Focused diagnostic: deploy a FRESH app, then interleave VIEW_BALANCE after every
// operation so we can see exactly which state transitions commit and which roll back.
// Reading committed state after each step is the only way to distinguish "the guest
// returned an error" from "the guest crashed" from "the guest wrongly accepted".

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

const PROCESSOR = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
const TEE_AUTH = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const MAX_FEE = 1000000n;
const ONE = 10n ** 18n;

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', 'noct-demo-wasm', 'noct-demo.wasm');

const provider = new ethers.JsonRpcProvider('http://localhost:8545');
const wallet = new ethers.Wallet(KEY, provider);
const client = new VelaClient(wallet, false, TEE_AUTH, PROCESSOR);

async function settle(requestId, fromBlock) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const head = await provider.getBlockNumber();
    const r = await client.getRequestCompletedEvent(requestId, head, fromBlock);
    if (r) return r;
  }
  return undefined;
}

async function send(appId, op, amount, asset) {
  const payload = JSON.stringify({ operation: op, amount: '0x' + amount.toString(16) });
  const enc = await client.encryptForTee(stringToBytes(payload));
  const from = await provider.getBlockNumber();
  const rr = await client.submitRequestAndWaitForRequestId(
    PROTOCOL_VERSION, appId, RequestType.PROCESS, enc, ETH_TOKEN, asset, MAX_FEE);
  const res = await settle(rr.requestId, from);
  const ec = !res ? 'TIMEOUT' : (res.errorCode === undefined ? '0' : res.errorCode.toString());
  let events = [];
  try {
    const head = await provider.getBlockNumber();
    const evs = await client.getCurrentUserEvents(
      head, from, appId, rr.requestId, undefined, () => true, false);
    events = evs.map(bytesToString);
  } catch { /* nothing readable */ }
  return { ec, msg: res?.errorMessage, events };
}

async function balance(appId) {
  const r = await send(appId, 'VIEW_BALANCE', 0n, 0n);
  if (r.events.length) {
    const b = JSON.parse(r.events[0]);
    return `collateral=${b.collateral} borrowed=${b.borrowed} nonce=${b.nonce}`;
  }
  return `(no event; errorCode=${r.ec})`;
}

// --- fresh deploy so the state is unambiguous
const wasmBytes = readFileSync(wasmPath);
const hash = createHash('sha256').update(wasmBytes).digest('hex');
let from = await provider.getBlockNumber();
const dep = await client.submitDeployRequestAndWaitForRequestId(
  PROTOCOL_VERSION, MAX_FEE, hexToBytes(hash),
  { collateral_ratio: 200, protocol_version: 'v1.0.0' });
let appId;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const head = await provider.getBlockNumber();
  const r = await client.getDeployRequestCompletedEvent(undefined, dep.requestId, head, from);
  if (r) { appId = r.applicationId; break; }
}
if (!appId) { console.error('deploy did not complete'); process.exit(1); }
console.log('fresh applicationId :', appId.toString());

// --- register the comms key (required before any PROCESS request)
const kp = await client.getSignerKeyPair();
console.log('P-521 pubkey bytes  :', hexToBytes(await exportPublicKeyToHex(kp.publicKey)).length);
from = await provider.getBlockNumber();
const akp = buildAssociateKeyPayload(kp.publicKey, undefined);
const ak = await client.submitRequestAndWaitForRequestId(
  PROTOCOL_VERSION, appId, RequestType.ASSOCIATEKEY,
  akp instanceof Promise ? await akp : akp, ETH_TOKEN, 0n, MAX_FEE);
const akr = await settle(ak.requestId, from);
console.log('associatekey        : errorCode=' +
  (akr?.errorCode === undefined ? '0' : akr.errorCode.toString()));

console.log('\nbalance at start    :', await balance(appId));

// Each probe records the committed balance AFTER the operation, which is what proves
// whether the transition stuck.
const probes = [
  ['DEPOSIT 1 ETH (asset moves in)', 'DEPOSIT', ONE, ONE],
  ['BORROW 0.4 ETH', 'BORROW', 4n * 10n ** 17n, 0n],
  ['BORROW 100 ETH (must be refused)', 'BORROW', 100n * ONE, 0n],
  ['WITHDRAW 50 ETH (must be refused)', 'WITHDRAW', 50n * ONE, 0n],
  ['REPAY 99 ETH (must be refused)', 'REPAY', 99n * ONE, 0n],
];

for (const [label, op, amt, asset] of probes) {
  const r = await send(appId, op, amt, asset);
  console.log(`\n${label}`);
  console.log(`  errorCode   : ${r.ec}${r.msg ? '  msg=' + r.msg.split('\n')[0] : ''}`);
  for (const e of r.events) console.log('  guest event :', e);
  console.log('  balance now :', await balance(appId));
}

console.log('\nfinal balance       :', await balance(appId));
console.log('applicationId       :', appId.toString());
