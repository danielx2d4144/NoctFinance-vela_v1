import { applyOperation, emptyState, userPosition } from './protocol.mjs';

const alice = '0x00000000000000000000000000000000000000a1';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function equal(actual, expected, message) { if (actual !== expected) throw new Error(message || `Expected ${actual} to equal ${expected}`); }
function throws(fn, pattern) { try { fn(); } catch (error) { if (!pattern.test(error.message)) throw new Error(`Expected error matching ${pattern}, got ${error.message}`); return; } throw new Error('Expected function to throw'); }

test('supports the complete healthy lending flow', () => {
  let state = emptyState();
  state = applyOperation(state, alice, 'DEPOSIT', '1000').state;
  state = applyOperation(state, alice, 'BORROW', '400').state;
  equal(userPosition(state, alice).borrowed, 400n);
  state = applyOperation(state, alice, 'REPAY', '400').state;
  state = applyOperation(state, alice, 'WITHDRAW', '1000').state;
  equal(userPosition(state, alice).collateral, 0n);
  equal(state.totalDeposits, '0');
});

test('enforces the 200 percent collateral rule', () => {
  let state = applyOperation(emptyState(), alice, 'DEPOSIT', '1000').state;
  throws(() => applyOperation(state, alice, 'BORROW', '501'), /Maximum borrow/);
  state = applyOperation(state, alice, 'BORROW', '500').state;
  throws(() => applyOperation(state, alice, 'WITHDRAW', '1'), /under-collateralize/);
});

test('rejects over-repayment and over-withdrawal', () => {
  let state = applyOperation(emptyState(), alice, 'DEPOSIT', '10').state;
  throws(() => applyOperation(state, alice, 'WITHDRAW', '11'), /exceeds/);
  throws(() => applyOperation(state, alice, 'REPAY', '1'), /outstanding debt/);
});

for (const { name, fn } of tests) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}
