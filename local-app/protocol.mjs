export const COLLATERAL_RATIO = 200n;
export const DEMO_ADDRESS = '0xDeaDbeef00000000000000000000000000000001';

const zero = () => 0n;

export function emptyState() {
  return {
    version: 'v0.1.0-local',
    collateralRatio: COLLATERAL_RATIO.toString(),
    totalDeposits: '0',
    totalBorrows: '0',
    accounts: {},
    transactions: [],
  };
}

export function normaliseState(value) {
  const state = value && typeof value === 'object' ? value : emptyState();
  return {
    ...emptyState(),
    ...state,
    accounts: state.accounts && typeof state.accounts === 'object' ? state.accounts : {},
    transactions: Array.isArray(state.transactions) ? state.transactions : [],
  };
}

function accountFor(state, address) {
  const key = address.toLowerCase();
  if (!state.accounts[key]) state.accounts[key] = { collateral: '0', borrowed: '0', nonce: 0 };
  return state.accounts[key];
}

function amount(value) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error('Enter an amount greater than zero');
  }
  const parsed = BigInt(String(value));
  if (parsed <= zero()) throw new Error('Enter an amount greater than zero');
  return parsed;
}

function withTx(state, address, operation, amountValue, status, error = '') {
  const tx = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    operation,
    amount: amountValue.toString(),
    address,
    status,
    error,
    timestamp: new Date().toISOString(),
  };
  state.transactions = [tx, ...state.transactions].slice(0, 20);
  return tx;
}

export function userPosition(state, address) {
  const account = accountFor(normaliseState(state), address);
  const collateral = BigInt(account.collateral || '0');
  const borrowed = BigInt(account.borrowed || '0');
  const ratio = BigInt(state.collateralRatio || COLLATERAL_RATIO);
  const maxBorrow = collateral * 100n / ratio;
  const health = borrowed === 0n ? null : Number((collateral * 10000n / (borrowed * ratio))) / 100;
  return { collateral, borrowed, maxBorrow, availableBorrow: maxBorrow > borrowed ? maxBorrow - borrowed : 0n, health };
}

export function applyOperation(inputState, address, operation, rawAmount = '0') {
  const state = normaliseState(structuredClone(inputState));
  const op = String(operation || '').toUpperCase();
  const requested = op === 'VIEW_BALANCE' ? zero() : amount(rawAmount);
  const account = accountFor(state, address);
  const collateral = BigInt(account.collateral || '0');
  const borrowed = BigInt(account.borrowed || '0');
  const totalDeposits = BigInt(state.totalDeposits || '0');
  const totalBorrows = BigInt(state.totalBorrows || '0');
  let message;

  if (op === 'DEPOSIT') {
    account.collateral = (collateral + requested).toString();
    state.totalDeposits = (totalDeposits + requested).toString();
    message = `Deposited ${requested} NOCT collateral`;
  } else if (op === 'BORROW') {
    const nextBorrow = borrowed + requested;
    if (nextBorrow * BigInt(state.collateralRatio) > collateral * 100n) {
      const max = collateral * 100n / BigInt(state.collateralRatio);
      throw new Error(`Insufficient collateral. Maximum borrow is ${max} NOCT`);
    }
    account.borrowed = nextBorrow.toString();
    state.totalBorrows = (totalBorrows + requested).toString();
    message = `Borrowed ${requested} NOCT`;
  } else if (op === 'REPAY') {
    if (requested > borrowed) throw new Error('Repayment exceeds your outstanding debt');
    account.borrowed = (borrowed - requested).toString();
    state.totalBorrows = (totalBorrows - requested).toString();
    message = `Repaid ${requested} NOCT`;
  } else if (op === 'WITHDRAW') {
    if (requested > collateral) throw new Error('Withdrawal exceeds your collateral');
    const remaining = collateral - requested;
    if (borrowed > 0n && borrowed * BigInt(state.collateralRatio) > remaining * 100n) {
      throw new Error('Withdrawal would under-collateralize your position');
    }
    account.collateral = remaining.toString();
    state.totalDeposits = (totalDeposits - requested).toString();
    message = `Withdrew ${requested} NOCT collateral`;
  } else if (op === 'VIEW_BALANCE') {
    return { state, position: userPosition(state, address), message: 'Position refreshed', tx: null };
  } else {
    throw new Error(`Unsupported operation: ${operation}`);
  }

  account.nonce = Number(account.nonce || 0) + 1;
  const tx = withTx(state, address, op, requested, 'confirmed');
  return { state, position: userPosition(state, address), message, tx };
}
