package noctmath

// This file is the normative SPEC-10 "Required surface" (TOOLCHAIN-LOCK.md,
// section "SPEC-10 — checked 256-bit arithmetic kernel", "Required surface").
//
// SPEC-10 mandates free functions over an unsigned 256-bit type returning
// (U256, ok bool):
//
//	Add(a, b)                 -> (U256, ok bool)   # ok=false on overflow
//	Sub(a, b)                 -> (U256, ok bool)   # ok=false on underflow
//	Mul(a, b)                 -> (U256, ok bool)   # ok=false on overflow
//	Div(a, b)                 -> (U256, ok bool)   # ok=false when b == 0
//	MulDivDown(a, b, d)       -> (U256, ok bool)
//	MulDivUp(a, b, d)         -> (U256, ok bool)
//	FromBytes32(be [32]byte)  -> (U256, ok bool)   # rejects non-canonical width
//	ToBytes32(a)              -> [32]byte
//	Cmp(a, b)                 -> int
//
// Every function here is a thin, logic-free adapter over the checked
// error-returning implementation in u256.go, div.go, muldiv.go and encoding.go.
// There is deliberately NO second arithmetic implementation: SPEC-10 property 6
// ("Single implementation") forbids two kernels that could round differently,
// and a duplicated body here would be exactly that. These adapters only
// translate the failure channel from `error` to `bool`.
//
// Why both channels exist. The bool surface is what the specification names and
// what financial transition code MUST call, because an unchecked `error` is easy
// to drop silently while `ok` cannot be ignored at the call-site shape used by
// the state machine. The error-returning channel is retained for host-side code
// and tests that must distinguish ErrOverflow from ErrUnderflow from
// ErrDivByZero, which a single bool cannot express: for Add/Sub/Mul/Div that is
// the checked method set ((U256).Add and friends, u256.go), and for the two
// full-width primitives it is MulDivDownErr/MulDivUpErr (muldiv.go). Both
// channels share one implementation and one set of golden vectors.
//
// Failure value contract. When ok is false these functions return Zero(), never
// a partial, wrapped or truncated result. SPEC-10 property 2 makes a wrapped
// value indistinguishable from a legitimate small one — the mechanism of
// DEMO-01 — so returning Zero removes any chance that a caller ignoring `ok`
// silently books a plausible-looking wrong balance. Zero is also what the
// underlying checked methods already return on failure, so nothing is changed.

// Add returns a+b. ok is false on overflow, i.e. when the sum exceeds 2^256-1.
// Free-function form of the checked method (U256).Add.
func Add(a, b U256) (U256, bool) {
	z, err := a.Add(b)
	if err != nil {
		return uZero, false
	}
	return z, true
}

// Sub returns a-b. ok is false on underflow, i.e. when b > a. Unsigned
// subtraction has no negative result, so underflow is the only failure and MUST
// be checked: an unnoticed wrap would turn a small balance minus a large debt
// into an enormous credit.
func Sub(a, b U256) (U256, bool) {
	z, err := a.Sub(b)
	if err != nil {
		return uZero, false
	}
	return z, true
}

// Mul returns a*b. ok is false when the 256-bit product overflows, even though
// the true product may be representable at 512 bits. Callers whose quotient
// would fit MUST use MulDivDown/MulDivUp instead, per SPEC-10 property 1.
func Mul(a, b U256) (U256, bool) {
	z, err := a.Mul(b)
	if err != nil {
		return uZero, false
	}
	return z, true
}

// Div returns a/b truncated toward zero. ok is false when b == 0. Division by
// zero MUST surface as ok=false rather than a wasm trap: SPEC-10 property 2
// forbids a trap as the failure policy, because a trap aborts the whole
// transition and cannot be handled by the state machine.
func Div(a, b U256) (U256, bool) {
	z, err := a.Div(b)
	if err != nil {
		return uZero, false
	}
	return z, true
}

// MulDivDown returns floor(a*b/d) with the product evaluated at full 512-bit
// width, per SPEC-10 property 1. ok is false when d == 0 or when the quotient
// does not fit in 256 bits.
//
// Spec-named adapter over MulDivDownErr; the full-width intermediate lives there
// and is not duplicated here.
func MulDivDown(a, b, d U256) (U256, bool) {
	z, err := MulDivDownErr(a, b, d)
	if err != nil {
		return uZero, false
	}
	return z, true
}

// MulDivUp returns ceil(a*b/d) with the product evaluated at full 512-bit width.
// ok is false when d == 0 or when the rounded-up quotient does not fit in 256
// bits, including the edge case where the exact quotient is 2^256-1 with a
// non-zero remainder.
//
// Per SPEC-10 property 4, MulDivUp(a, b, d) == 0 whenever a == 0 or b == 0, and
// ok is true in that case: zero is the correct answer, not a failure. Upward
// rounding is required for repayment, debt settlement and debt-index conversion
// (File 09:92-99, File 10:40-48) so a borrower can never settle for less than
// the debt they accrued; using MulDivDown there is a solvency defect.
func MulDivUp(a, b, d U256) (U256, bool) {
	z, err := MulDivUpErr(a, b, d)
	if err != nil {
		return uZero, false
	}
	return z, true
}

// FromBytes32 decodes exactly 32 unsigned big-endian bytes, the wire form
// required by File 09:20 and File 10:23.
//
// This direction is total over a [32]byte: the fixed-size array makes the width
// canonical by construction, so no 32-byte string can be rejected and ok is
// always true. The bool is retained because SPEC-10 names it, and because code
// written against the spec signature should not have to special-case this one
// constructor. Variable-width input — where a non-canonical width is actually
// possible — MUST go through FromBytes, which does reject it.
func FromBytes32(be [32]byte) (U256, bool) {
	return fromBytes32(be), true
}

// FromBytes decodes a big-endian byte slice and rejects any length other than
// exactly 32, returning ok=false.
//
// This is where SPEC-10's "rejects non-canonical width" is enforced. Accepting a
// shorter or longer encoding would let two distinct byte strings denote the same
// integer, which breaks the canonical serialisation behind appRoot and every
// File 09 subroot: identical state would hash differently, or different state
// would hash identically. The Phase 2 acceptance gate ("every financial field
// rejects non-canonical width, overflow/underflow, and native-integer or
// floating-point execution paths") is satisfied by routing all untrusted input
// through this function.
func FromBytes(be []byte) (U256, bool) {
	if len(be) != 32 {
		return uZero, false
	}
	var arr [32]byte
	copy(arr[:], be)
	return fromBytes32(arr), true
}

// ToBytes32 encodes a as exactly 32 unsigned big-endian bytes. Free-function
// form of the method (U256).ToBytes32; cannot fail.
func ToBytes32(a U256) [32]byte { return a.ToBytes32() }

// Cmp returns -1 if a < b, 0 if a == b, and +1 if a > b. Free-function form of
// the method (U256).Cmp; cannot fail.
func Cmp(a, b U256) int { return a.Cmp(b) }
