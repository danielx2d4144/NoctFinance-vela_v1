// Package noctmath is the Noct Finance V1 checked U256 arithmetic kernel.
//
// It exists because the pinned Vela SDK (github.com/HorizenOfficial/vela-common-go
// v0.2.0) cannot express the arithmetic mandated by the corrected architecture:
// its types.Uint256 offers only Mul64(uint64), has no exported division of any
// kind, and its Mul64 discards the overflow flag so a wrapped product is
// indistinguishable from a correct one (audit finding DEMO-01 / SPEC-10).
//
// Contract, from NOCT-FINANCE-V1-ARCHITECTURE-DOCUMENTS-CORRECTED:
//
//	File 08:37, File 10:23, File 19:50
//	  "MUST use an audited, TinyGo-compatible, checked U256 implementation with
//	   full-width mulDivDown and mulDivUp ... MUST NOT use Go uint64, int,
//	   float32, float64, math/big, unchecked multiplication, or a TinyGo
//	   overflow panic as an arithmetic policy. Every add, subtract, conversion
//	   and multiplication MUST return and handle overflow or underflow
//	   explicitly."
//
//	File 19:60
//	  "The multiplication is evaluated at full double width before division.
//	   Implementations MUST NOT emulate mulDiv with a checked U256
//	   multiplication that can reject a mathematically representable quotient."
//
//	File 08:39-108
//	  The custody decimal boundary: quantum, nativeToWad, wadToNative,
//	  quantizeDown, roundUpToQuantum.
//
// Design notes:
//
//   - U256 is four little-endian 64-bit limbs. limb[0] is least significant.
//   - No math/big, no reflection, no fmt, no floating point, no panics on the
//     arithmetic paths. All failures are returned as explicit errors.
//   - mulDivDown/mulDivUp build a true 512-bit product and divide it with
//     restoring binary long division. That is O(bitlen(quotient)) <= 256
//     iterations of a limb compare and subtract. Binary long division was chosen
//     over Knuth Algorithm D deliberately: it needs only bits.Sub64 and shifts,
//     so the borrow algebra cannot overflow, and the whole routine is short
//     enough to audit by inspection. For a TEE guest executing a handful of
//     mulDiv calls per transition this is not on the critical path. Swapping in
//     Algorithm D later is a pure optimisation with an unchanged interface.
//   - Verified under both the host Go toolchain (go test) and TinyGo 0.42
//     targeting wasi, using math/bits.{Mul64,Add64,Sub64,Div64,LeadingZeros64}.
package noctmath

import "errors"

// Sentinel errors. Callers MUST compare with errors.Is and MUST NOT treat any
// arithmetic failure as a zero result.
var (
	// ErrOverflow is returned when a result does not fit in 256 bits.
	ErrOverflow = errors.New("noctmath: u256 overflow")

	// ErrUnderflow is returned when a subtraction would go below zero.
	ErrUnderflow = errors.New("noctmath: u256 underflow")

	// ErrDivByZero is returned for any division or mulDiv with a zero divisor.
	ErrDivByZero = errors.New("noctmath: division by zero")

	// ErrInvalidEncoding is returned when bytes or hex are not a canonical U256.
	ErrInvalidEncoding = errors.New("noctmath: invalid u256 encoding")

	// ErrInvalidDecimals is returned when nativeDecimals is outside 0..18.
	// File 10:56-58: assets above 18 native decimals are not representable in
	// the V1 WAD domain.
	ErrInvalidDecimals = errors.New("noctmath: nativeDecimals outside 0..18")

	// ErrNotNativeRepresentable is returned when a WAD amount is required to be
	// a whole multiple of quantum but is not. File 08:74-76.
	ErrNotNativeRepresentable = errors.New("noctmath: amount is not a whole native unit")
)
