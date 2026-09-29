// End-to-end run of the NoctFinance guest against the LOCAL docker Vela stack.
//
// This targets the emulated-TEE stack in noct-vela-demo/dockerfiles (Anvil chain 31337,
// TEE_NO_ATTESTATION=true). It is NOT for Base Sepolia -- it asserts chainId 31337 and
// refuses to run anywhere else.
//
// Prerequisite: the artifact must already be uploaded to the authority service:
//   curl -X POST http://localhost:8081/deploy/upload -F "wasm=@noct-demo-wasm/noct-demo.wasm"
// The upload field name is `wasm` (recovered by probing the running container; `file`
// and raw octet-stream both return 400).
//
// Usage:
//   node local-e2e.js deploy
//   node local-e2e.js submit <appId> <operation> [amount]

import { ethers } from 'ethers';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RPC_URL = process.env.VELA_RPC_URL || 'http://localhost:8545';
const EXPECTED_CHAIN_ID = 31337n;
const PROCESSOR = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
const ETH_TOKEN = '0x0000000000000000000000000000000000000000';

// Anvil account #0. This is a publicly documented test key from the starter kit's
// .env.dev; it holds DEPLOYER_ROLE and admin on the LOCAL chain only. It has no value
// and no authority on any real network.
const DEPLOYER_KEY = process.env.VELA_DEPLOYER_PRIVATE_KEY
  || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const PROTOCOL_VERSION = 0;
const REQ_PROCESS = 1;

const ABI = [
  'function submitDeployRequest(uint8 protocolVersion, bytes payload) payable returns (bytes32)',
  'function submitRequest(uint8 protocolVersion, uint64 applicationId, uint8 requestType, bytes payload, address tokenAddress, uint256 assetAmount, uint256 maxFeeValue) payable returns (bytes32)',
  'function getDeployedAppIds() view returns (uint64[])',
  'function applicationStateRoots(uint64) view returns (bytes32)',
  'function getPendingRequestsSize() view returns (uint256)',
  'function DEPLOYER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32, address) view returns (bool)',
  'event DeployRequestSubmitted(uint64 indexed applicationId, bytes32 requestId, address indexed sender)',
  'event RequestSubmitted(uint64 indexed applicationId, bytes32 indexed requestId, address indexed sender, address facilitator)',
];

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', 'noct-demo-wasm', 'noct-demo.wasm');

function fatal(...lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

async function connect() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const chainId = (await provider.getNetwork()).chainId;
  if (chainId !== EXPECTED_CHAIN_ID) {
    fatal(`FATAL: chainId ${chainId}, expected ${EXPECTED_CHAIN_ID} (local Anvil).`,
      '  This script is for the LOCAL docker stack only.');
  }
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);
  return { provider, wallet, processor: new ethers.Contract(PROCESSOR, ABI, wallet) };
}

async function doDeploy() {
  const { provider, wallet, processor } = await connect();
  const wasmBytes = readFileSync(wasmPath);
  const hash = createHash('sha256').update(wasmBytes).digest('hex');

  console.log('chainId          : 31337 (local Anvil)');
  console.log('deployer         :', wallet.address);
  console.log('ProcessorEndpoint:', PROCESSOR);
  console.log('artifact         :', wasmBytes.length, 'bytes');
  console.log('sha256           :', hash);

  const role = await processor.DEPLOYER_ROLE();
  const ok = await processor.hasRole(role, wallet.address);
  console.log('DEPLOYER_ROLE    :', ok);
  if (!ok) fatal('FATAL: deployer lacks DEPLOYER_ROLE on the local ProcessorEndpoint.');

  // artifactId uses the "sha256:<hex>" form the starter-kit docs specify, and
  // wasmSha256 carries the bare fingerprint the TEE verifies the blob against.
  const descriptor = {
    mode: 'artifact_ref',
    artifactId: `sha256:${hash}`,
    wasmSha256: hash,
    constructorParams: { collateral_ratio: 200, protocol_version: 'v1.0.0' },
  };
  console.log('descriptor       :', JSON.stringify(descriptor));

  const before = (await processor.getDeployedAppIds()).map(String);
  const fromBlock = await provider.getBlockNumber();

  const tx = await processor.submitDeployRequest(
    PROTOCOL_VERSION,
    ethers.toUtf8Bytes(JSON.stringify(descriptor)),
    { value: ethers.parseEther('0.01') },
  );
  console.log('\ndeploy tx        :', tx.hash);
  const rc = await tx.wait();
  console.log('mined in block   :', rc.blockNumber, '| gas', rc.gasUsed.toString());

  for (const log of rc.logs) {
    let parsed;
    try { parsed = processor.interface.parseLog(log); } catch { continue; }
    if (!parsed) continue;
    console.log(`event            : ${parsed.name}`);
    if (parsed.name === 'DeployRequestSubmitted') {
      console.log('  applicationId  :', parsed.args.applicationId.toString());
      console.log('  requestId      :', parsed.args.requestId);
    }
  }

  console.log('\nwaiting for the TEE to pick up the deploy request...');
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const now = (await processor.getDeployedAppIds()).map(String);
    const added = now.filter((x) => !before.includes(x));
    if (added.length) {
      for (const id of added) {
        console.log('APP DEPLOYED     :', id);
        console.log('  stateRoot      :', await processor.applicationStateRoots(id));
      }
      return;
    }
  }
  console.log('timed out after 120s. Check: docker logs vela-skit-manager --since 5m');
  console.log('(fromBlock was', fromBlock, ')');
}

async function doSubmit(appId, operation, amount) {
  const { processor, wallet } = await connect();
  if (!appId || !operation) fatal('usage: node local-e2e.js submit <appId> <operation> [amount]');

  // The guest reads an OperationRequest {operation, amount} and parses `amount` with
  // Uint256.SetHex, so it MUST be a hex string. Operation names are the uppercase
  // constants in app/lending.go: DEPOSIT, BORROW, REPAY, WITHDRAW, VIEW_BALANCE.
  const op = operation.toUpperCase();
  const wei = BigInt(amount || '0');
  const payload = { operation: op, amount: '0x' + wei.toString(16) };
  const payloadBytes = ethers.toUtf8Bytes(JSON.stringify(payload));

  // Only a DEPOSIT actually moves an asset in. When assetAmount > 0 the runtime calls
  // the guest's `deposit` export before `process_request`; every other operation is a
  // pure state transition, so assetAmount stays 0.
  const assetAmount = op === 'DEPOSIT' ? wei : 0n;
  const maxFee = 1000000n;

  console.log('sender           :', wallet.address);
  console.log('applicationId    :', appId);
  console.log('payload          :', JSON.stringify(payload));
  console.log('assetAmount      :', assetAmount.toString());
  console.log('maxFeeValue      :', maxFee.toString());

  // ETH is the 0x0 sentinel, so msg.value must cover assetAmount + maxFeeValue.
  const value = assetAmount + maxFee;
  const tx = await processor.submitRequest(
    PROTOCOL_VERSION, BigInt(appId), REQ_PROCESS,
    payloadBytes, ETH_TOKEN, assetAmount, maxFee,
    { value },
  );
  console.log('\nrequest tx       :', tx.hash);
  const rc = await tx.wait();
  console.log('mined in block   :', rc.blockNumber, '| gas', rc.gasUsed.toString());

  for (const log of rc.logs) {
    let parsed;
    try { parsed = processor.interface.parseLog(log); } catch { continue; }
    if (!parsed) continue;
    console.log(`event            : ${parsed.name}`);
    if (parsed.name === 'RequestSubmitted') {
      console.log('  requestId      :', parsed.args.requestId);
    }
  }

  const rootBefore = await processor.applicationStateRoots(appId);
  console.log('\nstateRoot before :', rootBefore);
  console.log('waiting for the TEE to process...');
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const now = await processor.applicationStateRoots(appId);
    const pending = await processor.getPendingRequestsSize();
    if (now !== rootBefore) {
      console.log('stateRoot after  :', now);
      console.log('STATE ADVANCED   : the TEE executed the guest and committed a new root.');
      return;
    }
    if (i % 5 === 4) console.log(`  ...${(i + 1) * 2}s, pendingRequests=${pending}`);
  }
  console.log('state root unchanged after 90s. Check: docker logs vela-skit-manager --since 5m');
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'deploy') await doDeploy();
else if (cmd === 'submit') await doSubmit(rest[0], rest[1], rest[2]);
else fatal('usage: node local-e2e.js deploy | submit <appId> <operation> [amount]');
