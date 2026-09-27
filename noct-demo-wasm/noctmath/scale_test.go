package noctmath

import (
	"errors"
	"math/big"
	"strings"
	"testing"
)

// TestFile08OperationTable checks every helper named in the File 08:100-106
// contract table against math/big. These are thin wrappers over mulDiv, but they
// are the API the lending and risk code will actually call, so each one is
// verified rather than assumed correct by construction.
func TestFile08OperationTable(t *testing.T) {
	bigWad := toBig(Wad())
	bigRay := toBig(Ray())

	// Each entry describes how the helper maps its two arguments onto a
	// numerator pair and a divisor, and which rounding direction it must use.
	ops := []struct {
		name string
		fn   func(a, b U256) (U256, error)
		// operands returns (x, y, den) as big.Ints for want = round(x*y/den).
		operands func(ba, bb *big.Int) (x, y, den *big.Int)
		up       bool
		// divByZeroB reports whether a zero second argument must be rejected.
		divByZeroB bool
	}{
		{"WadMulDown", WadMulDown, func(ba, bb *big.Int) (*big.Int, *big.Int, *big.Int) {
			return ba, bb, bigWad
		}, false, false},
		{"WadMulUp", WadMulUp, func(ba, bb *big.Int) (*big.Int, *big.Int, *big.Int) {
			return ba, bb, bigWad
		}, true, false},
		{"WadDivDown", WadDivDown, func(ba, bb *big.Int) (*big.Int, *big.Int, *big.Int) {
			return ba, bigWad, bb
		}, false, true},
		{"WadDivUp", WadDivUp, func(ba, bb *big.Int) (*big.Int, *big.Int, *big.Int) {
			return ba, bigWad, bb
		}, true, true},
		{"RayMulDown", RayMulDown, func(ba, bb *big.Int) (*big.Int, *big.Int, *big.Int) {
			return ba, bb, bigRay
		}, false, false},
		{"RayMulUp", RayMulUp, func(ba, bb *big.Int) (*big.Int, *big.Int, *big.Int) {
			return ba, bb, bigRay
		}, true, false},
		{"RayDivDown", RayDivDown, func(ba, bb *big.Int) (*big.Int, *big.Int, *big.Int) {
			return ba, bigRay, bb
		}, false, true},
		{"RayDivUp", RayDivUp, func(ba, bb *big.Int) (*big.Int, *big.Int, *big.Int) {
			return ba, bigRay, bb
		}, true, true},
	}

	r := newRand()
	// Coverage counters so the table cannot pass while silently skipping the
	// interesting branches.
	hit := map[string]int{}
	hitErr := map[string]int{}

	for i := 0; i < diffIterations; i++ {
		a, b := randBiased(r), randBiased(r)
		ba, bb := toBig(a), toBig(b)

		for _, op := range ops {
			got, err := op.fn(a, b)

			if op.divByZeroB && bb.Sign() == 0 {
				if !errors.Is(err, ErrDivByZero) {
					t.Fatalf("%s(%s, 0) err = %v, want ErrDivByZero", op.name, a, err)
				}
				hitErr[op.name]++
				continue
			}

			x, y, den := op.operands(ba, bb)
			prod := new(big.Int).Mul(x, y)
			want := new(big.Int).Quo(prod, den)
			if op.up && new(big.Int).Rem(prod, den).Sign() != 0 {
				want.Add(want, big.NewInt(1))
			}

			if want.Cmp(big2to256) >= 0 {
				if !errors.Is(err, ErrOverflow) {
					t.Fatalf("%s(%s,%s) = %s, %v; want ErrOverflow", op.name, a, b, got, err)
				}
				hitErr[op.name]++
				continue
			}
			if err != nil {
				t.Fatalf("%s(%s,%s) unexpected error: %v", op.name, a, b, err)
			}
			if got != fromBig(t, want) {
				t.Fatalf("%s(%s,%s) = %s, want %v", op.name, a, b, got, want)
			}
			hit[op.name]++
		}
	}

	for _, op := range ops {
		if hit[op.name] == 0 {
			t.Errorf("%s: never produced a successful result", op.name)
		}
		if hitErr[op.name] == 0 {
			t.Errorf("%s: never produced an error, so its failure path is untested", op.name)
		}
	}
}

// TestFile08TableKnownValues pins a few readable results so a human reviewer can
// sanity-check the table without running the differential loop.
func TestFile08TableKnownValues(t *testing.T) {
	wad := Wad()
	ray := Ray()

	twoWad := mustDec(t, "2000000000000000000")
	threeWad := mustDec(t, "3000000000000000000")
	halfWad := mustDec(t, "500000000000000000")
	sixWad := mustDec(t, "6000000000000000000")

	// (2e18 * 3e18) / 1e18 = 6e18 -- the ordinary fixed-point multiply.
	if got, err := WadMulDown(twoWad, threeWad); err != nil || got != sixWad {
		t.Fatalf("WadMulDown(2,3) = %s, %v; want %s", got, err, sixWad)
	}
	if got, err := WadMulUp(twoWad, threeWad); err != nil || got != sixWad {
		t.Fatalf("WadMulUp(2,3) = %s, %v; want %s (exact, so up == down)", got, err, sixWad)
	}

	// 3 * 0.5 = 1.5, so the two rounding directions must differ by one unit.
	if got, err := WadMulDown(FromUint64(3), halfWad); err != nil || got != One() {
		t.Fatalf("WadMulDown(3, 0.5) = %s, %v; want 1", got, err)
	}
	if got, err := WadMulUp(FromUint64(3), halfWad); err != nil || got != FromUint64(2) {
		t.Fatalf("WadMulUp(3, 0.5) = %s, %v; want 2", got, err)
	}

	// 1 / 3 in the WAD domain: wad*wad/3 = 1e36/3, i.e. thirty-six 3s.
	wantDivDown := mustDec(t, strings.Repeat("3", 36))
	wantDivUp := mustDec(t, strings.Repeat("3", 35)+"4")
	if got, err := WadDivDown(wad, FromUint64(3)); err != nil || got != wantDivDown {
		t.Fatalf("WadDivDown(1,3) = %s, %v; want %s", got, err, wantDivDown)
	}
	if got, err := WadDivUp(wad, FromUint64(3)); err != nil || got != wantDivUp {
		t.Fatalf("WadDivUp(1,3) = %s, %v; want %s", got, err, wantDivUp)
	}

	// The RAY variants behave identically at their own scale. RayDivDown(ray, 3)
	// is ray*ray/3 = 1e54/3, i.e. fifty-four 3s; the repetition is written out
	// rather than hand-typed so the digit count is self-evident.
	if got, err := RayDivDown(ray, FromUint64(3)); err != nil || got != mustDec(t, strings.Repeat("3", 54)) {
		t.Fatalf("RayDivDown(1,3) = %s, %v", got, err)
	}
	upWant := strings.Repeat("3", 53) + "4"
	if got, err := RayDivUp(ray, FromUint64(3)); err != nil || got != mustDec(t, upWant) {
		t.Fatalf("RayDivUp(1,3) = %s, %v", got, err)
	}
	if got, err := RayMulDown(FromUint64(3), mustDec(t, "500000000000000000000000000")); err != nil || got != One() {
		t.Fatalf("RayMulDown(3, 0.5) = %s, %v; want 1", got, err)
	}
	if got, err := RayMulUp(FromUint64(3), mustDec(t, "500000000000000000000000000")); err != nil || got != FromUint64(2) {
		t.Fatalf("RayMulUp(3, 0.5) = %s, %v; want 2", got, err)
	}

	// Division by zero must be rejected in every direction.
	for _, op := range []struct {
		name string
		fn   func(a, b U256) (U256, error)
	}{
		{"WadDivDown", WadDivDown}, {"WadDivUp", WadDivUp},
		{"RayDivDown", RayDivDown}, {"RayDivUp", RayDivUp},
	} {
		if _, err := op.fn(wad, Zero()); !errors.Is(err, ErrDivByZero) {
			t.Fatalf("%s(x, 0) err = %v, want ErrDivByZero", op.name, err)
		}
	}
}

// TestSpecConformanceVectors maps 1:1 onto the "Required conformance vectors"
// list in TOOLCHAIN-LOCK.md SPEC-10. The lock states that a hand-rolled
// math/bits kernel is permitted only if it ships these vectors and passes under
// TinyGo 0.42 for wasm32/wasi, so each bullet is covered by a named case here and
// the wasm32 half is enforced by tools/verify-guest-wasm.ps1.
func TestSpecConformanceVectors(t *testing.T) {
	max := MaxU256()
	one := One()
	zero := Zero()
	ray := Ray()
	wad := Wad()

	// Bullet: MulDivUpErr(x, RAY, index) and MulDivDownErr(x, RAY, index) for
	// index = RAY and index > RAY.
	x := mustDec(t, "777000000000000000000") // an arbitrary scaled debt
	t.Run("index equals RAY is the identity", func(t *testing.T) {
		down, err := MulDivDownErr(x, ray, ray)
		if err != nil || down != x {
			t.Fatalf("MulDivDownErr(x,RAY,RAY) = %s, %v; want %s", down, err, x)
		}
		up, err := MulDivUpErr(x, ray, ray)
		if err != nil || up != x {
			t.Fatalf("MulDivUpErr(x,RAY,RAY) = %s, %v; want %s (exact, so no rounding)", up, err, x)
		}
	})
	t.Run("index above RAY accrues and rounds up for debt", func(t *testing.T) {
		index := must(ray.Add(mustDec(t, "1"))) // RAY + 1, the smallest accrual
		down, err := MulDivDownErr(x, index, ray)
		if err != nil {
			t.Fatalf("MulDivDown: %v", err)
		}
		up, err := MulDivUpErr(x, index, ray)
		if err != nil {
			t.Fatalf("MulDivUp: %v", err)
		}
		if up.Cmp(down) < 0 {
			t.Fatalf("up %s < down %s", up, down)
		}
		// Debt conversion rounds up, so it must never be below the principal.
		if up.Cmp(x) < 0 {
			t.Fatalf("accrued debt %s fell below principal %s", up, x)
		}
	})

	// Bullet: quantizeDown and wadToNative for quantum = 10^12 (USDC) and
	// quantum = 1 (ETH, ZEN), including a value whose low 12 decimal digits are
	// all nonzero.
	// 1234567890123456789 has low 12 digits 890123456789 -- all nonzero.
	usdcWad := mustDec(t, "1234567890123456789")
	t.Run("USDC quantum 1e12", func(t *testing.T) {
		if q, _ := Quantum(6); q != mustDec(t, "1000000000000") {
			t.Fatalf("quantum(6) = %s", q)
		}
		if got, _ := QuantizeDown(usdcWad, 6); got != mustDec(t, "1234567000000000000") {
			t.Fatalf("quantizeDown = %s", got)
		}
		if got, _ := WadToNative(usdcWad, 6); got != FromUint64(1234567) {
			t.Fatalf("wadToNative = %s", got)
		}
	})
	t.Run("ETH/ZEN quantum 1 is lossless", func(t *testing.T) {
		if q, _ := Quantum(18); q != one {
			t.Fatalf("quantum(18) = %s, want 1", q)
		}
		// With quantum 1 every WAD amount is representable and both conversions
		// must be exact identities. Losing a single wei here would be a silent
		// rounding bug on the most common asset class.
		if got, _ := QuantizeDown(usdcWad, 18); got != usdcWad {
			t.Fatalf("quantizeDown(18) = %s, want unchanged", got)
		}
		if got, _ := RoundUpToQuantum(usdcWad, 18); got != usdcWad {
			t.Fatalf("roundUpToQuantum(18) = %s, want unchanged", got)
		}
		if got, _ := WadToNative(usdcWad, 18); got != usdcWad {
			t.Fatalf("wadToNative(18) = %s, want unchanged", got)
		}
		if ok, _ := IsNativeRepresentable(max, 18); !ok {
			t.Fatalf("every WAD amount must be representable at 18 decimals")
		}
	})

	// Bullet: a = 0, b = 0, d = 0, d = 1, a = 2^256-1.
	t.Run("degenerate operands", func(t *testing.T) {
		if got, err := MulDivUpErr(zero, max, wad); err != nil || !got.IsZero() {
			t.Fatalf("MulDivUpErr(0,b,d) = %s, %v; want 0 per SPEC-10 property 4", got, err)
		}
		if got, err := MulDivUpErr(max, zero, wad); err != nil || !got.IsZero() {
			t.Fatalf("MulDivUpErr(a,0,d) = %s, %v; want 0 per SPEC-10 property 4", got, err)
		}
		if _, err := MulDivUpErr(one, one, zero); !errors.Is(err, ErrDivByZero) {
			t.Fatalf("MulDivUpErr(a,b,0) err = %v, want ErrDivByZero", err)
		}
		if _, err := MulDivDownErr(max, max, one); !errors.Is(err, ErrOverflow) {
			t.Fatalf("MulDivDownErr(max,max,1) err = %v, want ErrOverflow", err)
		}
		// a = 2^256-1 with a divisor large enough that the quotient fits.
		if got, err := MulDivDownErr(max, one, one); err != nil || got != max {
			t.Fatalf("MulDivDownErr(max,1,1) = %s, %v; want max", got, err)
		}
	})

	// Bullet: every overflow case returns a failure rather than a wrapped value.
	t.Run("overflow never wraps", func(t *testing.T) {
		cases := []struct {
			name string
			fn   func() (U256, error)
		}{
			{"add", func() (U256, error) { return max.Add(one) }},
			{"sub", func() (U256, error) { return zero.Sub(one) }},
			{"mul", func() (U256, error) { return max.Mul(max) }},
			{"shl", func() (U256, error) { return max.Shl(1) }},
			{"muldiv", func() (U256, error) { return MulDivUpErr(max, max, one) }},
			{"wadToRay", func() (U256, error) { return WadToRay(max) }},
		}
		for _, tc := range cases {
			got, err := tc.fn()
			if err == nil {
				t.Errorf("%s: expected an error, got %s", tc.name, got)
				continue
			}
			if !got.IsZero() {
				t.Errorf("%s: error path returned non-zero %s; a wrapped value is indistinguishable from a legitimate one", tc.name, got)
			}
		}
	})
}

func TestTenAndBit(t *testing.T) {
	if Ten() != FromUint64(10) {
		t.Fatalf("Ten() = %s, want 10", Ten())
	}

	z := U256{0x0123456789abcdef, 0xfedcba9876543210, 0x0f0f0f0f0f0f0f0f, 0xf0f0f0f0f0f0f0f0}
	for i := uint(0); i < 300; i++ {
		want := uint64(0)
		if i < 256 {
			want = uint64(toBig(z).Bit(int(i)))
		}
		if got := z.Bit(i); got != want {
			t.Fatalf("Bit(%d) = %d, want %d", i, got, want)
		}
	}
	if One().Bit(0) != 1 || One().Bit(1) != 0 {
		t.Fatalf("One().Bit is wrong")
	}
	if MaxU256().Bit(255) != 1 || MaxU256().Bit(256) != 0 {
		t.Fatalf("MaxU256().Bit is wrong")
	}
}
