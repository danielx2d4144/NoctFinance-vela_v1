package noctmath

// This file implements the custody decimal boundary of File 08:39-132.
//
// The rule that governs all of it: the protocol's internal domain is WAD (18
// decimals), but assets are custodied in their own native decimals (USDC has 6).
// A WAD amount is only transferable when it is a whole multiple of
// quantum = 10^(18-nativeDecimals). Conversions MUST be explicit and MUST round
// in the protocol's favour. There is no implicit float, no implicit truncation,
// and no asset-specific special case.

// Quantum returns 10^(18-nativeDecimals): the number of WAD units in one whole
// native token unit. For USDC (6 decimals) it is 10^12; for an 18-decimal asset
// it is 1.
//
// It returns ErrInvalidDecimals when nativeDecimals > 18. File 10:56-58 is
// explicit that an asset with more than 18 native decimals is not representable
// in the V1 WAD domain, so such an asset MUST be rejected at registration rather
// than silently downcast.
func Quantum(nativeDecimals uint) (U256, error) {
	if nativeDecimals > 18 {
		return uZero, ErrInvalidDecimals
	}
	return Pow10(18 - nativeDecimals)
}

// NativeToWad converts a native-token amount into the WAD domain:
//
//	wad = native * 10^(18-nativeDecimals)
//
// This direction is exact and never truncates, but it CAN overflow: a large
// native balance times the quantum may exceed 2^256-1. The overflow is returned
// as ErrOverflow, never wrapped.
func NativeToWad(native U256, nativeDecimals uint) (U256, error) {
	q, err := Quantum(nativeDecimals)
	if err != nil {
		return uZero, err
	}
	wad, err := native.Mul(q)
	if err != nil {
		return uZero, err
	}
	return wad, nil
}

// WadToNative converts a WAD amount to native units by flooring:
//
//	native = wad / 10^(18-nativeDecimals)
//
// The discarded remainder is precision the protocol gives up in the user's
// favour. Callers that must not lose value should use QuantizeDown to keep the
// WAD-domain representation consistent, or RoundUpToQuantum when charging the
// user.
func WadToNative(wad U256, nativeDecimals uint) (U256, error) {
	q, err := Quantum(nativeDecimals)
	if err != nil {
		return uZero, err
	}
	native, err := wad.Div(q)
	if err != nil {
		return uZero, err
	}
	return native, nil
}

// IsNativeRepresentable reports whether wad is a whole multiple of quantum.
// File 08:74-76 requires this to hold for any amount that will actually cross a
// custody boundary; a false answer means the caller must quantize or reject.
func IsNativeRepresentable(wad U256, nativeDecimals uint) (bool, error) {
	q, err := Quantum(nativeDecimals)
	if err != nil {
		return false, err
	}
	rem, err := wad.Mod(q)
	if err != nil {
		return false, err
	}
	return rem.IsZero(), nil
}

// QuantizeDown floors wad to the nearest whole native unit and returns it to the
// WAD domain:
//
//	quantizeDown(w) = (w / quantum) * quantum
//
// The result is always native-representable and never exceeds w, so the protocol
// never promises more than it can custody. The two steps cannot overflow: the
// division shrinks the value and the multiplication restores exactly what was
// divided out.
func QuantizeDown(wad U256, nativeDecimals uint) (U256, error) {
	q, err := Quantum(nativeDecimals)
	if err != nil {
		return uZero, err
	}
	units, err := wad.Div(q)
	if err != nil {
		return uZero, err
	}
	out, err := units.Mul(q)
	if err != nil {
		return uZero, err
	}
	return out, nil
}

// RoundUpToQuantum rounds wad UP to the nearest whole native unit in the WAD
// domain:
//
//	roundUpToQuantum(w) = ceil(w / quantum) * quantum
//
// File 08:96-99 gives this as checkedMul((w + quantum - 1) / quantum, quantum).
// It is implemented here as divide, conditional increment, multiply instead. The
// two are algebraically identical, but the literal form computes w+quantum-1
// first, which can overflow for w near 2^256-1 and turn a rounding operation
// into a spurious failure. Splitting the increment after the division removes
// that intermediate entirely while producing the same value in every case.
//
// Rounding up is the correct direction when the user owes the protocol: debt
// repayment and fee accrual must never be rounded down in the borrower's favour.
func RoundUpToQuantum(wad U256, nativeDecimals uint) (U256, error) {
	q, err := Quantum(nativeDecimals)
	if err != nil {
		return uZero, err
	}
	units, rem, err := wad.QuoRem(q)
	if err != nil {
		return uZero, err
	}
	if !rem.IsZero() {
		if units, err = units.Add(uOne); err != nil {
			return uZero, err
		}
	}
	out, err := units.Mul(q)
	if err != nil {
		return uZero, err
	}
	return out, nil
}

// AssertNativeRepresentable returns wad unchanged when it is a whole multiple of
// quantum, and ErrNotNativeRepresentable otherwise. Use it at custody boundaries
// where a non-quantized amount indicates an upstream bug that must halt the
// transition rather than be silently truncated.
func AssertNativeRepresentable(wad U256, nativeDecimals uint) (U256, error) {
	ok, err := IsNativeRepresentable(wad, nativeDecimals)
	if err != nil {
		return uZero, err
	}
	if !ok {
		return uZero, ErrNotNativeRepresentable
	}
	return wad, nil
}

// --- WAD-domain fixed-point arithmetic (File 08:100-106) ---------------------
//
// Every helper below is a thin, explicitly-rounded wrapper over the full-width
// mulDiv. They exist so call sites state their rounding direction instead of
// re-deriving it, and so the WAD constant is never re-typed at a call site.

// WadMulDown returns floor(a*b/1e18). Use for interest accrual credited to a
// supplier and for any multiplication where rounding down favours the protocol.
func WadMulDown(a, b U256) (U256, error) { return MulDivDownErr(a, b, uWad) }

// WadMulUp returns ceil(a*b/1e18). Use where rounding up charges the user.
func WadMulUp(a, b U256) (U256, error) { return MulDivUpErr(a, b, uWad) }

// WadDivDown returns floor(a*1e18/b), the WAD-domain a/b rounded down.
func WadDivDown(a, b U256) (U256, error) { return MulDivDownErr(a, uWad, b) }

// WadDivUp returns ceil(a*1e18/b), the WAD-domain a/b rounded up. Required for
// debt settlement so a borrower can never repay fractionally less than owed.
func WadDivUp(a, b U256) (U256, error) { return MulDivUpErr(a, uWad, b) }

// --- RAY-domain risk-engine arithmetic (File 08:112-132) --------------------
//
// RAY (1e27) is a precision unit for the debt index and risk factors only. A RAY
// value is NOT a balance and MUST be converted back to WAD before it touches any
// amount, debt or transfer. Keeping these helpers separate from the WAD set makes
// a domain confusion visible at the call site.

// RayMulDown returns floor(a*b/1e27).
func RayMulDown(a, b U256) (U256, error) { return MulDivDownErr(a, b, uRay) }

// RayMulUp returns ceil(a*b/1e27). Use for debt-index conversion, which rounds up
// so accrued debt is never understated.
func RayMulUp(a, b U256) (U256, error) { return MulDivUpErr(a, b, uRay) }

// RayDivDown returns floor(a*1e27/b).
func RayDivDown(a, b U256) (U256, error) { return MulDivDownErr(a, uRay, b) }

// RayDivUp returns ceil(a*1e27/b).
func RayDivUp(a, b U256) (U256, error) { return MulDivUpErr(a, uRay, b) }

// WadToRay scales a WAD amount into the RAY domain: r = w * 1e9. Exact, but it
// can overflow, and the overflow is returned rather than wrapped.
func WadToRay(wad U256) (U256, error) {
	scale, err := Pow10(9)
	if err != nil {
		return uZero, err
	}
	return wad.Mul(scale)
}

// RayToWad scales a RAY amount back into the WAD domain: w = floor(r / 1e9).
// The floor discards sub-WAD precision. Because RAY carries more precision than
// WAD, this conversion is lossy by construction; that is acceptable only for
// risk factors and never for a custodied amount.
func RayToWad(ray U256) (U256, error) {
	scale, err := Pow10(9)
	if err != nil {
		return uZero, err
	}
	return ray.Div(scale)
}
