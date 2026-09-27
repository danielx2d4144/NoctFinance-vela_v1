package noctmath

import (
	"bytes"
	"errors"
	"testing"
)

// The SPEC-10 "Required surface" is a signature contract, not a suggestion.
// These package-level assertions are checked by the compiler: if any named
// function is removed, renamed, or drifts from (U256, ok bool) to some other
// shape, this file stops building. That is a stronger gate than a runtime test,
// because it cannot be skipped, and it is the reason the earlier
// (U256, error) vs (U256, bool) mismatch between spec and implementation could
// not recur unnoticed.
var (
	_ func(a, b U256) (U256, bool)     = Add
	_ func(a, b U256) (U256, bool)     = Sub
	_ func(a, b U256) (U256, bool)     = Mul
	_ func(a, b U256) (U256, bool)     = Div
	_ func(a, b, d U256) (U256, bool)  = MulDivDown
	_ func(a, b, d U256) (U256, bool)  = MulDivUp
	_ func(be [32]byte) (U256, bool)   = FromBytes32
	_ func(a U256) [32]byte            = ToBytes32
	_ func(a, b U256) int              = Cmp
	_ func(a, b, d U256) (U256, error) = MulDivDownErr
	_ func(a, b, d U256) (U256, error) = MulDivUpErr
)

// specEdges are the values SPEC-10 requires in its conformance vectors:
// a = 0, b = 0, d = 0, d = 1, a = 2^256-1, plus WAD/RAY boundary values and a
// power of two large enough that a*b exceeds 2^256-1 while the quotient does not.
func specEdges(t *testing.T) []U256 {
	t.Helper()
	p200 := mustPow2(t, 200)
	rayPlusOne, err := uRay.Add(uOne)
	if err != nil {
		t.Fatalf("RAY+1: %v", err)
	}
	return []U256{
		uZero, uOne, uTen, uWad, uRay, rayPlusOne, p200, uMax,
	}
}

// TestSpec10BoolChannelMatchesErrChannel proves the two failure channels cannot
// diverge. SPEC-10 property 6 requires a single implementation; the bool surface
// is an adapter, so for every input pair it must agree exactly with the
// error-returning one — same value on success, same ok/err truth on failure.
// A divergence here would mean two kernels rounding differently, i.e. two
// protocols.
func TestSpec10BoolChannelMatchesErrChannel(t *testing.T) {
	edges := specEdges(t)

	type binOp struct {
		name string
		b    func(a, b U256) (U256, bool)
		e    func(a, b U256) (U256, error)
	}
	binOps := []binOp{
		{"Add", Add, func(a, b U256) (U256, error) { return a.Add(b) }},
		{"Sub", Sub, func(a, b U256) (U256, error) { return a.Sub(b) }},
		{"Mul", Mul, func(a, b U256) (U256, error) { return a.Mul(b) }},
		{"Div", Div, func(a, b U256) (U256, error) { return a.Div(b) }},
	}
	for _, op := range binOps {
		for _, a := range edges {
			for _, b := range edges {
				gotVal, gotOK := op.b(a, b)
				wantVal, wantErr := op.e(a, b)
				if gotOK != (wantErr == nil) {
					t.Errorf("%s(%s,%s): ok=%v but err=%v", op.name, a, b, gotOK, wantErr)
					continue
				}
				if gotVal != wantVal {
					t.Errorf("%s(%s,%s): bool channel=%s err channel=%s", op.name, a, b, gotVal, wantVal)
				}
			}
		}
	}

	type triOp struct {
		name string
		b    func(a, b, d U256) (U256, bool)
		e    func(a, b, d U256) (U256, error)
	}
	triOps := []triOp{
		{"MulDivDown", MulDivDown, MulDivDownErr},
		{"MulDivUp", MulDivUp, MulDivUpErr},
	}
	for _, op := range triOps {
		for _, a := range edges {
			for _, b := range edges {
				for _, d := range edges {
					gotVal, gotOK := op.b(a, b, d)
					wantVal, wantErr := op.e(a, b, d)
					if gotOK != (wantErr == nil) {
						t.Errorf("%s(%s,%s,%s): ok=%v but err=%v", op.name, a, b, d, gotOK, wantErr)
						continue
					}
					if gotVal != wantVal {
						t.Errorf("%s(%s,%s,%s): bool=%s err=%s", op.name, a, b, d, gotVal, wantVal)
					}
				}
			}
		}
	}
}

// TestSpec10FailureReturnsZeroNotWrapped asserts the failure value contract.
// SPEC-10 property 2 exists because a wrapped result is indistinguishable from a
// legitimate small value — the exact mechanism of DEMO-01. So on every failure
// path the returned value MUST be Zero, never the truncated/wrapped arithmetic
// result. This is what stops a caller that ignores `ok` from booking a
// plausible-looking wrong balance.
func TestSpec10FailureReturnsZeroNotWrapped(t *testing.T) {
	cases := []struct {
		name string
		fn   func() (U256, bool)
	}{
		// max + 1 wraps to 0 in unchecked arithmetic.
		{"add_overflow", func() (U256, bool) { return Add(uMax, uOne) }},
		// 0 - 1 wraps to max in unchecked arithmetic — the dangerous direction.
		{"sub_underflow", func() (U256, bool) { return Sub(uZero, uOne) }},
		{"mul_overflow", func() (U256, bool) { return Mul(uMax, uMax) }},
		{"div_by_zero", func() (U256, bool) { return Div(uOne, uZero) }},
		{"muldiv_by_zero", func() (U256, bool) { return MulDivDown(uOne, uOne, uZero) }},
		{"muldivup_by_zero", func() (U256, bool) { return MulDivUp(uOne, uOne, uZero) }},
		{"muldiv_overflow", func() (U256, bool) { return MulDivDown(uMax, uMax, uOne) }},
	}
	for _, tc := range cases {
		got, ok := tc.fn()
		if ok {
			t.Errorf("%s: ok=true, want false", tc.name)
		}
		if !got.IsZero() {
			t.Errorf("%s: failure returned %s, want Zero (wrapped/partial value leaks)", tc.name, got)
		}
	}

	// The unchecked-wrap direction is asserted explicitly: 0-1 must NOT equal max.
	if v, ok := Sub(uZero, uOne); ok || v == uMax {
		t.Fatalf("Sub(0,1) = %s,%v; must not wrap to 2^256-1", v, ok)
	}
}

// TestSpec10FullWidthIntermediate covers the vector SPEC-10 property 1 names
// explicitly: a*b exceeds 2^256-1 but the quotient does not. The naive
// checked-Mul-then-Div construction rejects this, so passing it is what proves
// the intermediate really is 512 bits.
func TestSpec10FullWidthIntermediate(t *testing.T) {
	p200 := mustPow2(t, 200)

	// 2^200 * 2^200 = 2^400, far beyond 2^256-1, yet 2^400 / 2^200 = 2^200.
	if _, ok := Mul(p200, p200); ok {
		t.Errorf("Mul(2^200,2^200) ok=true; the 256-bit product must overflow")
	}
	got, ok := MulDivDown(p200, p200, p200)
	if !ok || got != p200 {
		t.Errorf("MulDivDown(2^200,2^200,2^200) = %s,%v; want 2^200,true", got, ok)
	}
	gotUp, okUp := MulDivUp(p200, p200, p200)
	if !okUp || gotUp != p200 {
		t.Errorf("MulDivUp(2^200,2^200,2^200) = %s,%v; want 2^200,true (exact, no rounding)", gotUp, okUp)
	}
}

// TestSpec10MulDivUpZeroSemantics covers property 4: MulDivUp(a,b,d) = 0 when
// a = 0 or b = 0. Any other convention changes every debt and index calculation,
// and note that ok MUST be true — zero is the correct answer, not a failure.
func TestSpec10MulDivUpZeroSemantics(t *testing.T) {
	if v, ok := MulDivUp(uZero, uMax, uWad); !ok || !v.IsZero() {
		t.Errorf("MulDivUp(0,max,WAD) = %s,%v; want 0,true", v, ok)
	}
	if v, ok := MulDivUp(uMax, uZero, uWad); !ok || !v.IsZero() {
		t.Errorf("MulDivUp(max,0,WAD) = %s,%v; want 0,true", v, ok)
	}
	if v, ok := MulDivDown(uZero, uMax, uWad); !ok || !v.IsZero() {
		t.Errorf("MulDivDown(0,max,WAD) = %s,%v; want 0,true", v, ok)
	}
	// d = 1 is required by the vector list and must be an identity on the product.
	if v, ok := MulDivDown(uMax, uOne, uOne); !ok || v != uMax {
		t.Errorf("MulDivDown(max,1,1) = %s,%v; want max,true", v, ok)
	}
}

// TestSpec10RayWadBoundary covers the vectors "MulDivUp(x, RAY, index) and
// MulDivDown(x, RAY, index) for index = RAY and index > RAY", which is the shape
// of mulDivUp(scaledDebt, borrowIndex, RAY) used for every debt conversion.
func TestSpec10RayWadBoundary(t *testing.T) {
	principal := uWad // 1e18 WAD
	rayPlusOne, err := uRay.Add(uOne)
	if err != nil {
		t.Fatalf("RAY+1: %v", err)
	}

	// index == RAY is exact: no rounding in either direction.
	down, okD := MulDivDown(principal, uRay, uRay)
	up, okU := MulDivUp(principal, uRay, uRay)
	if !okD || !okU || down != principal || up != principal {
		t.Fatalf("index=RAY: down=%s,%v up=%s,%v; want %s exact both ways", down, okD, up, okU, principal)
	}

	// index > RAY accrues interest: ceil must exceed floor.
	down2, okD2 := MulDivDown(principal, rayPlusOne, uRay)
	up2, okU2 := MulDivUp(principal, rayPlusOne, uRay)
	if !okD2 || !okU2 {
		t.Fatalf("index=RAY+1: ok=%v,%v; want true,true", okD2, okU2)
	}
	wantUp, err := uWad.Add(uOne)
	if err != nil {
		t.Fatalf("WAD+1: %v", err)
	}
	if down2 != uWad {
		t.Errorf("MulDivDown(WAD,RAY+1,RAY) = %s; want %s", down2, uWad)
	}
	if up2 != wantUp {
		t.Errorf("MulDivUp(WAD,RAY+1,RAY) = %s; want %s (rounds in protocol's favour)", up2, wantUp)
	}
	if Cmp(up2, down2) < 0 {
		t.Errorf("MulDivUp %s < MulDivDown %s; ceil must never be below floor", up2, down2)
	}
}

// TestSpec10EncodingCanonicalWidth covers ToBytes32/FromBytes32/FromBytes and the
// "rejects non-canonical width" requirement. A variable-width decoder would let
// two distinct byte strings denote the same integer, breaking every commitment
// derived from canonical serialisation.
func TestSpec10EncodingCanonicalWidth(t *testing.T) {
	for _, z := range []U256{uZero, uOne, uWad, uRay, uMax, mustPow2(t, 200)} {
		b := ToBytes32(z)
		got, ok := FromBytes32(b)
		if !ok || got != z {
			t.Errorf("FromBytes32(ToBytes32(%s)) = %s,%v; want round-trip", z, got, ok)
		}
		if mb := z.ToBytes32(); !bytes.Equal(mb[:], b[:]) {
			t.Errorf("ToBytes32(%s) free func != method form", z)
		}
		gotSlice, okSlice := FromBytes(b[:])
		if !okSlice || gotSlice != z {
			t.Errorf("FromBytes(%s) = %s,%v; want round-trip", z, gotSlice, okSlice)
		}
	}

	maxBytes := ToBytes32(uMax)
	for _, bad := range [][]byte{
		nil,
		{},
		maxBytes[:31],
		append([]byte{0}, maxBytes[:]...), // 33 bytes, zero-padded prefix
		append(append([]byte{}, maxBytes[:]...), 0), // 33 bytes, suffix
		make([]byte, 64),
		{0x01}, // short big-endian 1: exactly the ambiguity that must fail
	} {
		if v, ok := FromBytes(bad); ok || !v.IsZero() {
			t.Errorf("FromBytes(len=%d) = %s,%v; want Zero,false (non-canonical width)", len(bad), v, ok)
		}
	}
}

// TestSpec10CmpAgreesWithMethod pins Cmp's three-valued result and its agreement
// with the method form.
func TestSpec10CmpAgreesWithMethod(t *testing.T) {
	pairs := [][2]U256{
		{uZero, uZero}, {uZero, uOne}, {uOne, uZero},
		{uMax, uMax}, {uMax, uZero}, {uWad, uRay}, {uRay, uWad},
	}
	for _, p := range pairs {
		want := p[0].Cmp(p[1])
		got := Cmp(p[0], p[1])
		if got != want {
			t.Errorf("Cmp(%s,%s) = %d; method form gives %d", p[0], p[1], got, want)
		}
		if got < -1 || got > 1 {
			t.Errorf("Cmp(%s,%s) = %d; want -1, 0 or +1", p[0], p[1], got)
		}
	}
	if Cmp(uWad, uRay) >= 0 {
		t.Errorf("Cmp(WAD,RAY) = %d; WAD (1e18) must be < RAY (1e27)", Cmp(uWad, uRay))
	}
}

// TestSpec10ErrChannelPreservesDistinctErrors documents why the error channel is
// kept alongside the bool one: a bool cannot distinguish overflow from underflow
// from division by zero, and host-side diagnostics need that distinction.
func TestSpec10ErrChannelPreservesDistinctErrors(t *testing.T) {
	if _, err := MulDivDownErr(uMax, uMax, uOne); !errors.Is(err, ErrOverflow) {
		t.Errorf("MulDivDownErr(max,max,1) err = %v; want ErrOverflow", err)
	}
	if _, err := MulDivUpErr(uOne, uOne, uZero); !errors.Is(err, ErrDivByZero) {
		t.Errorf("MulDivUpErr(1,1,0) err = %v; want ErrDivByZero", err)
	}
	if _, err := uZero.Sub(uOne); !errors.Is(err, ErrUnderflow) {
		t.Errorf("Sub(0,1) err = %v; want ErrUnderflow", err)
	}
	if _, err := uMax.Add(uOne); !errors.Is(err, ErrOverflow) {
		t.Errorf("Add(max,1) err = %v; want ErrOverflow", err)
	}
}
