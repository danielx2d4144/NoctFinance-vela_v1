package noctmath

// Golden vectors for the checked U256 kernel.
//
// Unlike differential_test.go, which proves broad agreement with math/big, these
// are fixed, named, human-readable scenarios drawn from the corrected
// architecture. They exist so that a future refactor or a second implementation
// (TypeScript for E2E, Noir for the circuits) can be checked against identical
// expected values, and so the specific cases the spec calls out are locked in by
// name rather than being left to chance in a random distribution.
//
// The expected literals below were generated independently with math/big
// (tools/goldgen) and are written out longhand. They are deliberately NOT
// computed by calling the kernel, which would make the test circular.

import (
	"errors"
	"math/big"
	"testing"
)

// mustDec parses a decimal string into a U256 using math/big, independent of the
// code under test.
func mustDec(t *testing.T, s string) U256 {
	t.Helper()
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		t.Fatalf("bad decimal literal in test table: %q", s)
	}
	return fromBig(t, v)
}

// mustPow2 returns 2^n as a U256.
func mustPow2(t *testing.T, n uint) U256 {
	t.Helper()
	return fromBig(t, new(big.Int).Lsh(big.NewInt(1), n))
}

// must unwraps a kernel result that the test knows cannot fail, failing loudly if
// that assumption is wrong. It is for constructing test inputs only; a result
// under assertion is always checked explicitly so an unexpected error is reported
// as the specific failure it is.
func must(v U256, err error) U256 {
	if err != nil {
		panic("test helper: unexpected error: " + err.Error())
	}
	return v
}

func TestGoldenAddSubBoundaries(t *testing.T) {
	max := MaxU256()
	one := One()

	cases := []struct {
		name    string
		a, b    U256
		op      string // "add" or "sub"
		want    U256
		wantErr error
	}{
		{"add zero zero", Zero(), Zero(), "add", Zero(), nil},
		{"add max zero", max, Zero(), "add", max, nil},
		{"add one one", one, one, "add", FromUint64(2), nil},
		{"add max one overflows", max, one, "add", Zero(), ErrOverflow},
		{"add half plus half overflows", mustPow2(t, 255), mustPow2(t, 255), "add", Zero(), ErrOverflow},
		{"add max minus one plus one", func() U256 { v, _ := max.Sub(one); return v }(), one, "add", max, nil},

		{"sub zero zero", Zero(), Zero(), "sub", Zero(), nil},
		{"sub max max", max, max, "sub", Zero(), nil},
		{"sub zero one underflows", Zero(), one, "sub", Zero(), ErrUnderflow},
		{"sub five seven underflows", FromUint64(5), FromUint64(7), "sub", Zero(), ErrUnderflow},
		{"sub one from zero underflows", FromUint64(0), FromUint64(1), "sub", Zero(), ErrUnderflow},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got U256
			var err error
			if tc.op == "add" {
				got, err = tc.a.Add(tc.b)
			} else {
				got, err = tc.a.Sub(tc.b)
			}
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			if tc.wantErr == nil && got != tc.want {
				t.Fatalf("got %s, want %s", got, tc.want)
			}
			if tc.wantErr != nil && !got.IsZero() {
				// On failure the result must be the zero value, never a wrapped
				// number that a careless caller could use.
				t.Fatalf("error path returned non-zero value %s", got)
			}
		})
	}
}

func TestGoldenMulBoundaries(t *testing.T) {
	max := MaxU256()
	half := mustPow2(t, 128)
	halfMinusOne := func() U256 { v, _ := half.Sub(One()); return v }()

	cases := []struct {
		name    string
		a, b    U256
		want    U256
		wantErr error
	}{
		{"zero times max", Zero(), max, Zero(), nil},
		{"one times max", One(), max, max, nil},
		{"max times max overflows", max, max, Zero(), ErrOverflow},
		{"2^128 times 2^128 is exactly 2^256", half, half, Zero(), ErrOverflow},
		// 2^128 * (2^128-1) = 2^256 - 2^128: the largest product of two
		// 128-bit-shaped operands that still fits, one unit below the case above.
		{
			"2^128 times (2^128-1) fits",
			half, halfMinusOne,
			mustDec(t, "115792089237316195423570985008687907852929702298719625575994209400481361428480"),
			nil,
		},
		// WAD*WAD = 1e36, comfortably inside 256 bits. This is the single most
		// common shape in the protocol -- every fixed-point multiply -- so it must
		// succeed. An implementation that rejected it would be useless.
		{
			"wad times wad is 1e36",
			Wad(), Wad(),
			mustDec(t, "1000000000000000000000000000000000000"),
			nil,
		},
		{"max times two overflows", max, FromUint64(2), Zero(), ErrOverflow},
		// (2^255-1)*2 = 2^256-2: the largest even value, one below overflow.
		{
			"half of max times two fits",
			max.Shr(1), FromUint64(2),
			mustDec(t, "115792089237316195423570985008687907853269984665640564039457584007913129639934"),
			nil,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := tc.a.Mul(tc.b)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			if tc.wantErr != nil {
				if !got.IsZero() {
					t.Fatalf("error path returned non-zero value %s", got)
				}
				return
			}
			if got != tc.want {
				t.Fatalf("got %s, want %s", got, tc.want)
			}
		})
	}
}

func TestGoldenDivision(t *testing.T) {
	max := MaxU256()

	cases := []struct {
		name    string
		a, b    U256
		wantQ   U256
		wantR   U256
		wantErr error
	}{
		{"zero over five", Zero(), FromUint64(5), Zero(), Zero(), nil},
		{"zero over zero is div by zero", Zero(), Zero(), Zero(), Zero(), ErrDivByZero},
		{"five over zero is div by zero", FromUint64(5), Zero(), Zero(), Zero(), ErrDivByZero},
		{"max over zero is div by zero", max, Zero(), Zero(), Zero(), ErrDivByZero},
		{"seven over two", FromUint64(7), FromUint64(2), FromUint64(3), FromUint64(1), nil},
		{"max over one", max, One(), max, Zero(), nil},
		{"max over max", max, max, One(), Zero(), nil},
		{"exact division has zero remainder", FromUint64(1000), FromUint64(10), FromUint64(100), Zero(), nil},
		// 1 WAD / 3 must floor, never round up, in the down direction.
		{
			"wad over three",
			Wad(), FromUint64(3),
			mustDec(t, "333333333333333333"),
			FromUint64(1),
			nil,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			q, r, err := tc.a.QuoRem(tc.b)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			if tc.wantErr != nil {
				return
			}
			if q != tc.wantQ {
				t.Fatalf("quotient = %s, want %s", q, tc.wantQ)
			}
			if r != tc.wantR {
				t.Fatalf("remainder = %s, want %s", r, tc.wantR)
			}
		})
	}
}

// TestGoldenMulDivFullWidth covers the requirement in File 19:60 that the
// multiplication be evaluated at full double width, and that an implementation
// MUST NOT reject a mathematically representable quotient merely because the
// intermediate product exceeded 256 bits.
func TestGoldenMulDivFullWidth(t *testing.T) {
	max := MaxU256()
	p200 := mustPow2(t, 200)
	p120 := mustPow2(t, 120)
	p65m1 := func() U256 { v, _ := mustPow2(t, 65).Sub(One()); return v }()
	maxMinusOne := func() U256 { v, _ := max.Sub(One()); return v }()

	cases := []struct {
		name        string
		a, b, den   U256
		wantDown    U256
		wantUp      U256
		wantDownErr error
		wantUpErr   error
	}{
		{
			// Product is 2^400, far beyond 256 bits, yet the quotient is exact.
			// A naive checked-Mul-then-Div implementation rejects this.
			name: "product 2^400 but quotient 2^200 is representable",
			a:    p200, b: p200, den: p200,
			wantDown: p200, wantUp: p200,
		},
		{
			// The shift == 256 band: bitLen(product)=321, bitLen(den)=65, so the
			// naive guard `shift > 255` would reject this even though the true
			// quotient is 256 bits wide and fits exactly. Regression lock.
			name: "quotient at exactly 256 bits must not be rejected",
			a:    p200, b: p120, den: p65m1,
			wantDown: U256{0x1000000000000000, 0x2000000000000000, 0x4000000000000000, 0x8000000000000000},
			wantUp:   U256{0x1000000000000001, 0x2000000000000000, 0x4000000000000000, 0x8000000000000000},
		},
		{
			// Zero numerator is legitimate, not an error.
			name: "zero numerator",
			a:    Zero(), b: max, den: FromUint64(7),
			wantDown: Zero(), wantUp: Zero(),
		},
		{
			name: "zero denominator is div by zero",
			a:    FromUint64(1), b: FromUint64(1), den: Zero(),
			wantDownErr: ErrDivByZero, wantUpErr: ErrDivByZero,
		},
		{
			// max*max/1: the quotient itself does not fit, so this genuinely fails.
			name: "quotient far exceeds 256 bits",
			a:    max, b: max, den: One(),
			wantDownErr: ErrOverflow, wantUpErr: ErrOverflow,
		},
		{
			// max*max/(max-1) = 2^256 remainder 1: the quotient sits exactly one
			// unit above the representable ceiling, in both rounding directions.
			// This is the tightest overflow boundary the kernel can encounter.
			name: "quotient exactly 2^256 overflows",
			a:    max, b: max, den: maxMinusOne,
			wantDownErr: ErrOverflow, wantUpErr: ErrOverflow,
		},
		{
			// max*max/max = max exactly, remainder zero: the largest quotient that
			// still fits, and up/down must agree because nothing is discarded.
			name: "quotient exactly 2^256-1 with no remainder",
			a:    max, b: max, den: max,
			wantDown: max, wantUp: max,
		},
		{
			// Rounding direction must differ whenever there is a remainder.
			name: "seven over two distinguishes down from up",
			a:    FromUint64(7), b: One(), den: FromUint64(2),
			wantDown: FromUint64(3), wantUp: FromUint64(4),
		},
		{
			// Exact division: up and down must agree.
			name: "exact division has no rounding gap",
			a:    FromUint64(8), b: One(), den: FromUint64(2),
			wantDown: FromUint64(4), wantUp: FromUint64(4),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotDown, errDown := MulDivDownErr(tc.a, tc.b, tc.den)
			gotUp, errUp := MulDivUpErr(tc.a, tc.b, tc.den)

			if !errors.Is(errDown, tc.wantDownErr) {
				t.Fatalf("MulDivDown err = %v, want %v", errDown, tc.wantDownErr)
			}
			if !errors.Is(errUp, tc.wantUpErr) {
				t.Fatalf("MulDivUp err = %v, want %v", errUp, tc.wantUpErr)
			}

			if tc.wantDownErr != nil {
				if !gotDown.IsZero() {
					t.Fatalf("MulDivDown error path returned non-zero %s", gotDown)
				}
			} else if gotDown != tc.wantDown {
				t.Fatalf("MulDivDown = %s, want %s", gotDown, tc.wantDown)
			}

			if tc.wantUpErr != nil {
				if !gotUp.IsZero() {
					t.Fatalf("MulDivUp error path returned non-zero %s", gotUp)
				}
			} else if gotUp != tc.wantUp {
				t.Fatalf("MulDivUp = %s, want %s", gotUp, tc.wantUp)
			}

			// Where both succeed, rounding up must never go below rounding down.
			if tc.wantDownErr == nil && tc.wantUpErr == nil && gotUp.Cmp(gotDown) < 0 {
				t.Fatalf("MulDivUp %s < MulDivDown %s", gotUp, gotDown)
			}
		})
	}
}

// TestGoldenMulRejectsWhereMulDivAccepts is the precise distinction that
// DEMO-01 violated. The checked 256-bit multiply must reject an unrepresentable
// product, while mulDiv must still accept the same operands when the quotient
// after division is representable. Collapsing the two -- computing a*b in U256
// and then dividing -- is the defect.
func TestGoldenMulRejectsWhereMulDivAccepts(t *testing.T) {
	a := mustPow2(t, 200)
	b := mustPow2(t, 200)

	if _, err := a.Mul(b); !errors.Is(err, ErrOverflow) {
		t.Fatalf("Mul(2^200, 2^200) err = %v, want ErrOverflow", err)
	}
	got, err := MulDivDownErr(a, b, mustPow2(t, 200))
	if err != nil {
		t.Fatalf("MulDivDownErr(2^200, 2^200, 2^200) unexpected error: %v", err)
	}
	if got != a {
		t.Fatalf("MulDivDown = %s, want %s", got, a)
	}
}

// TestGoldenDebtIndexRounding covers File 10:40-48: converting scaled principal
// to current debt via the RAY debt index MUST round up, so a borrower can never
// settle for less than the debt actually accrued. The vectors use an index ratio
// of RAY+1 over RAY, which produces a one-unit difference between the rounding
// directions -- small enough to be invisible in a demo, large enough to be a
// solvency leak if the direction is wrong.
func TestGoldenDebtIndexRounding(t *testing.T) {
	ray := Ray()
	rayPlusOne, err := ray.Add(One())
	if err != nil {
		t.Fatalf("constructing RAY+1: %v", err)
	}

	principalWad := mustDec(t, "1000000000000000000000") // 1000 tokens in WAD
	wantDown := mustDec(t, "1000000000000000000000")     // unchanged
	wantUp := mustDec(t, "1000000000000000000001")       // one unit more

	gotDown, err := MulDivDownErr(principalWad, rayPlusOne, ray)
	if err != nil {
		t.Fatalf("MulDivDown: %v", err)
	}
	gotUp, err := MulDivUpErr(principalWad, rayPlusOne, ray)
	if err != nil {
		t.Fatalf("MulDivUp: %v", err)
	}

	if gotDown != wantDown {
		t.Fatalf("debt rounded down = %s, want %s", gotDown, wantDown)
	}
	if gotUp != wantUp {
		t.Fatalf("debt rounded up = %s, want %s", gotUp, wantUp)
	}
	if gotUp.Cmp(gotDown) <= 0 {
		t.Fatalf("up-rounded debt %s must exceed down-rounded debt %s", gotUp, gotDown)
	}

	// RayMulDown divides the product by RAY, so scaling by RAY+1 leaves the
	// principal unchanged after flooring. This pins the RAY divisor itself.
	scaled, err := RayMulDown(principalWad, rayPlusOne)
	if err != nil {
		t.Fatalf("RayMulDown: %v", err)
	}
	if scaled != principalWad {
		t.Fatalf("RayMulDown(principal, RAY+1) = %s, want %s", scaled, principalWad)
	}

	// RayMulUp on the same inputs must round the discarded fraction up.
	scaledUp, err := RayMulUp(principalWad, rayPlusOne)
	if err != nil {
		t.Fatalf("RayMulUp: %v", err)
	}
	if scaledUp != wantUp {
		t.Fatalf("RayMulUp(principal, RAY+1) = %s, want %s", scaledUp, wantUp)
	}
}

// TestGoldenRayWadDomainConversion locks the RAY/WAD relationship and the rule
// that RAY is a precision unit, not a balance domain (File 08:112-132).
func TestGoldenRayWadDomainConversion(t *testing.T) {
	if Wad() != mustDec(t, "1000000000000000000") {
		t.Fatalf("WAD constant = %s", Wad())
	}
	if Ray() != mustDec(t, "1000000000000000000000000000") {
		t.Fatalf("RAY constant = %s", Ray())
	}
	if SecondsPerYear() != FromUint64(31536000) {
		t.Fatalf("SecondsPerYear = %s, want 31536000", SecondsPerYear())
	}

	r, err := WadToRay(Wad())
	if err != nil {
		t.Fatalf("WadToRay: %v", err)
	}
	if r != Ray() {
		t.Fatalf("WadToRay(WAD) = %s, want RAY", r)
	}

	w, err := RayToWad(Ray())
	if err != nil {
		t.Fatalf("RayToWad: %v", err)
	}
	if w != Wad() {
		t.Fatalf("RayToWad(RAY) = %s, want WAD", w)
	}

	// RayToWad floors, so sub-WAD precision is discarded rather than rounded.
	subWadRay, err := Ray().Add(mustDec(t, "999999999"))
	if err != nil {
		t.Fatalf("constructing RAY+999999999: %v", err)
	}
	floored, err := RayToWad(subWadRay)
	if err != nil {
		t.Fatalf("RayToWad: %v", err)
	}
	if floored != Wad() {
		t.Fatalf("RayToWad(RAY + 0.999999999 WAD) = %s, want WAD (floor)", floored)
	}

	// WadToRay can overflow, and must report it rather than wrap.
	if _, err := WadToRay(MaxU256()); !errors.Is(err, ErrOverflow) {
		t.Fatalf("WadToRay(max) err = %v, want ErrOverflow", err)
	}
}

// TestGoldenUSDCQuantization covers the File 08:39-108 custody decimal boundary
// for a 6-decimal asset, the concrete case that matters for USDC.
func TestGoldenUSDCQuantization(t *testing.T) {
	const usdcDecimals = uint(6)

	q, err := Quantum(usdcDecimals)
	if err != nil {
		t.Fatalf("Quantum(6): %v", err)
	}
	if q != mustDec(t, "1000000000000") {
		t.Fatalf("quantum(6) = %s, want 1e12", q)
	}

	// 1.234567890123456789 USDC expressed in the WAD domain.
	wad := mustDec(t, "1234567890123456789")

	native, err := WadToNative(wad, usdcDecimals)
	if err != nil {
		t.Fatalf("WadToNative: %v", err)
	}
	if native != FromUint64(1234567) {
		t.Fatalf("WadToNative = %s, want 1234567", native)
	}

	down, err := QuantizeDown(wad, usdcDecimals)
	if err != nil {
		t.Fatalf("QuantizeDown: %v", err)
	}
	if down != mustDec(t, "1234567000000000000") {
		t.Fatalf("QuantizeDown = %s, want 1234567000000000000", down)
	}

	up, err := RoundUpToQuantum(wad, usdcDecimals)
	if err != nil {
		t.Fatalf("RoundUpToQuantum: %v", err)
	}
	if up != mustDec(t, "1234568000000000000") {
		t.Fatalf("RoundUpToQuantum = %s, want 1234568000000000000", up)
	}

	// QuantizeDown must never exceed the input; RoundUpToQuantum must never be
	// below it. Getting either direction backwards leaks or steals a fraction of
	// a token on every single custody operation.
	if down.Cmp(wad) > 0 {
		t.Fatalf("QuantizeDown %s exceeds input %s", down, wad)
	}
	if up.Cmp(wad) < 0 {
		t.Fatalf("RoundUpToQuantum %s below input %s", up, wad)
	}

	if ok, _ := IsNativeRepresentable(wad, usdcDecimals); ok {
		t.Fatalf("1234567890123456789 must not be native-representable at 6 decimals")
	}
	if ok, _ := IsNativeRepresentable(down, usdcDecimals); !ok {
		t.Fatalf("QuantizeDown result must be native-representable")
	}
	if ok, _ := IsNativeRepresentable(up, usdcDecimals); !ok {
		t.Fatalf("RoundUpToQuantum result must be native-representable")
	}
	if _, err := AssertNativeRepresentable(wad, usdcDecimals); !errors.Is(err, ErrNotNativeRepresentable) {
		t.Fatalf("AssertNativeRepresentable err = %v, want ErrNotNativeRepresentable", err)
	}
	if got, err := AssertNativeRepresentable(down, usdcDecimals); err != nil || got != down {
		t.Fatalf("AssertNativeRepresentable(quantized) = %s, %v", got, err)
	}

	// NativeToWad is the exact inverse on representable values.
	back, err := NativeToWad(native, usdcDecimals)
	if err != nil {
		t.Fatalf("NativeToWad: %v", err)
	}
	if back != down {
		t.Fatalf("NativeToWad(WadToNative(w)) = %s, want %s", back, down)
	}

	// An already-exact amount round-trips unchanged in both directions.
	exact := mustDec(t, "5000000000000000000") // 5 USDC
	if d, _ := QuantizeDown(exact, usdcDecimals); d != exact {
		t.Fatalf("QuantizeDown(5e18) = %s, want unchanged", d)
	}
	if u, _ := RoundUpToQuantum(exact, usdcDecimals); u != exact {
		t.Fatalf("RoundUpToQuantum(5e18) = %s, want unchanged", u)
	}

	// Zero is representable and quantizes to itself.
	if ok, _ := IsNativeRepresentable(Zero(), usdcDecimals); !ok {
		t.Fatalf("zero must be native-representable")
	}
	if d, _ := QuantizeDown(Zero(), usdcDecimals); !d.IsZero() {
		t.Fatalf("QuantizeDown(0) = %s, want 0", d)
	}
}

// TestGoldenQuantumDecimalsRange covers File 10:56-58: more than 18 native
// decimals is not representable in the WAD domain and must be rejected at
// registration rather than silently downcast.
func TestGoldenQuantumDecimalsRange(t *testing.T) {
	for nd := uint(0); nd <= 18; nd++ {
		q, err := Quantum(nd)
		if err != nil {
			t.Fatalf("Quantum(%d) unexpected error: %v", nd, err)
		}
		want, _ := Pow10(18 - nd)
		if q != want {
			t.Fatalf("Quantum(%d) = %s, want %s", nd, q, want)
		}
	}
	if _, err := Quantum(19); !errors.Is(err, ErrInvalidDecimals) {
		t.Fatalf("Quantum(19) err = %v, want ErrInvalidDecimals", err)
	}
	if _, err := Quantum(255); !errors.Is(err, ErrInvalidDecimals) {
		t.Fatalf("Quantum(255) err = %v, want ErrInvalidDecimals", err)
	}
	if _, err := NativeToWad(One(), 19); !errors.Is(err, ErrInvalidDecimals) {
		t.Fatalf("NativeToWad with 19 decimals err = %v, want ErrInvalidDecimals", err)
	}
	// 18 decimals means quantum 1, so every WAD amount is representable.
	if q, _ := Quantum(18); q != One() {
		t.Fatalf("Quantum(18) = %s, want 1", q)
	}
	// Pow10 caps at 10^77, the largest power below 2^256.
	if _, err := Pow10(77); err != nil {
		t.Fatalf("Pow10(77) unexpected error: %v", err)
	}
	if _, err := Pow10(78); !errors.Is(err, ErrOverflow) {
		t.Fatalf("Pow10(78) err = %v, want ErrOverflow", err)
	}
}
