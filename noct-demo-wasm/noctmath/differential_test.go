package noctmath

// Differential tests against math/big.
//
// math/big is NOT permitted in production code (File 08:39, File 10:23 forbid it
// in the guest) but it is the right oracle here: it is independently implemented,
// decades old, and heavily audited. Every kernel operation is checked against it
// over a seeded, reproducible value distribution that concentrates on the places
// multi-limb arithmetic actually breaks -- limb boundaries, carries out of the
// top limb, zero, one, and values within a few units of 2^256-1.
//
// These tests run under `go test` only. TinyGo compatibility is verified
// separately by compiling the package for wasi; the tests deliberately import
// math/big and math/rand, which the guest must never do.

import (
	"math/big"
	"math/rand"
	"testing"
)

const diffIterations = 20000

// newRand returns a deterministic generator. The seed is fixed so a failure is
// reproducible without needing a -count loop or a captured seed.
func newRand() *rand.Rand { return rand.New(rand.NewSource(0x4E4F4354)) } // "NOCT"

// toBig converts via the 32-byte big-endian form, which cross-checks ToBytes32
// on every single comparison rather than only in the encoding tests.
func toBig(z U256) *big.Int {
	b := z.ToBytes32()
	return new(big.Int).SetBytes(b[:])
}

// fromBig narrows a big.Int to U256, failing the test if it does not fit.
func fromBig(t *testing.T, v *big.Int) U256 {
	t.Helper()
	b := v.Bytes()
	if len(b) > 32 {
		t.Fatalf("oracle produced a value wider than 256 bits: %v", v)
	}
	var arr [32]byte
	copy(arr[32-len(b):], b)
	return fromBytes32(arr)
}

// u512ToBig reads the full-width product as a big.Int, most significant limb
// first.
func u512ToBig(u u512) *big.Int {
	v := new(big.Int)
	for i := 7; i >= 0; i-- {
		v.Lsh(v, 64)
		v.Or(v, new(big.Int).SetUint64(u[i]))
	}
	return v
}

var big2to256 = new(big.Int).Lsh(big.NewInt(1), 256)

// randU256 returns a uniform random 256-bit value.
func randU256(r *rand.Rand) U256 {
	var b [32]byte
	for i := range b {
		b[i] = byte(r.Intn(256))
	}
	return fromBytes32(b)
}

// randBiased returns a value drawn from a distribution weighted towards the
// cases that expose limb-carry and boundary bugs. Uniform random 256-bit values
// almost never land near 0, 1, a limb boundary or 2^256-1, so testing only those
// would give false confidence.
func randBiased(r *rand.Rand) U256 {
	switch r.Intn(10) {
	case 0:
		return uZero
	case 1:
		return uOne
	case 2:
		// Just below / at / just above each 64-bit limb boundary.
		bit := uint(r.Intn(256))
		v := uOne
		v, _ = v.Shl(bit)
		if r.Intn(2) == 0 {
			// 2^bit - 1
			out, _ := v.Sub(uOne)
			return out
		}
		return v
	case 3:
		// Within a few units of 2^256-1.
		delta := uint64(r.Intn(5))
		out, _ := uMax.Sub(FromUint64(delta))
		return out
	case 4:
		// Small values, where financial quantities usually live.
		return FromUint64(r.Uint64())
	case 5:
		// Values around WAD and RAY.
		switch r.Intn(4) {
		case 0:
			return uWad
		case 1:
			return uRay
		case 2:
			out, _ := uWad.Add(FromUint64(uint64(r.Intn(3))))
			return out
		default:
			out, _ := uWad.Sub(FromUint64(uint64(r.Intn(3))))
			return out
		}
	default:
		return randU256(r)
	}
}

func TestMul512Differential(t *testing.T) {
	r := newRand()
	for i := 0; i < diffIterations; i++ {
		a, b := randBiased(r), randBiased(r)
		got := u512ToBig(mul512(a, b))
		want := new(big.Int).Mul(toBig(a), toBig(b))
		if got.Cmp(want) != 0 {
			t.Fatalf("mul512(%s, %s):\n got  %v\n want %v", a, b, got, want)
		}
	}
}

func TestAddSubMulDifferential(t *testing.T) {
	r := newRand()
	for i := 0; i < diffIterations; i++ {
		a, b := randBiased(r), randBiased(r)
		ba, bb := toBig(a), toBig(b)

		// Add: exact when the sum fits, ErrOverflow when it does not.
		sum := new(big.Int).Add(ba, bb)
		gotAdd, errAdd := a.Add(b)
		if sum.Cmp(big2to256) >= 0 {
			if errAdd == nil {
				t.Fatalf("Add(%s,%s) = %v, want ErrOverflow", a, b, gotAdd)
			}
		} else {
			if errAdd != nil {
				t.Fatalf("Add(%s,%s) unexpected error: %v", a, b, errAdd)
			}
			if gotAdd != fromBig(t, sum) {
				t.Fatalf("Add(%s,%s) = %s, want %v", a, b, gotAdd, sum)
			}
		}

		// Sub: exact when a >= b, ErrUnderflow otherwise.
		gotSub, errSub := a.Sub(b)
		if ba.Cmp(bb) < 0 {
			if errSub == nil {
				t.Fatalf("Sub(%s,%s) = %v, want ErrUnderflow", a, b, gotSub)
			}
		} else {
			if errSub != nil {
				t.Fatalf("Sub(%s,%s) unexpected error: %v", a, b, errSub)
			}
			if gotSub != fromBig(t, new(big.Int).Sub(ba, bb)) {
				t.Fatalf("Sub(%s,%s) = %s, want %v", a, b, gotSub, new(big.Int).Sub(ba, bb))
			}
		}

		// Mul: exact when the product fits, ErrOverflow otherwise.
		prod := new(big.Int).Mul(ba, bb)
		gotMul, errMul := a.Mul(b)
		if prod.Cmp(big2to256) >= 0 {
			if errMul == nil {
				t.Fatalf("Mul(%s,%s) = %v, want ErrOverflow", a, b, gotMul)
			}
		} else {
			if errMul != nil {
				t.Fatalf("Mul(%s,%s) unexpected error: %v", a, b, errMul)
			}
			if gotMul != fromBig(t, prod) {
				t.Fatalf("Mul(%s,%s) = %s, want %v", a, b, gotMul, prod)
			}
		}
	}
}

func TestQuoRemDifferential(t *testing.T) {
	r := newRand()
	zeroDivisorSeen := 0
	for i := 0; i < diffIterations; i++ {
		a, b := randBiased(r), randBiased(r)
		ba, bb := toBig(a), toBig(b)

		q, rem, err := a.QuoRem(b)
		if bb.Sign() == 0 {
			if err == nil {
				t.Fatalf("QuoRem(%s, 0) = %v/%v, want ErrDivByZero", a, q, rem)
			}
			zeroDivisorSeen++
			continue
		}
		if err != nil {
			t.Fatalf("QuoRem(%s,%s) unexpected error: %v", a, b, err)
		}
		wantQ := new(big.Int).Quo(ba, bb)
		wantR := new(big.Int).Rem(ba, bb)
		if q != fromBig(t, wantQ) {
			t.Fatalf("QuoRem(%s,%s) quotient = %s, want %v", a, b, q, wantQ)
		}
		if rem != fromBig(t, wantR) {
			t.Fatalf("QuoRem(%s,%s) remainder = %s, want %v", a, b, rem, wantR)
		}
	}
	if zeroDivisorSeen == 0 {
		t.Errorf("never exercised a zero divisor; distribution is too weak")
	}
}

func TestMulDivDifferential(t *testing.T) {
	r := newRand()

	// Coverage counters. A differential test that never reaches the interesting
	// region passes vacuously, so the regions File 19:60 actually cares about are
	// asserted to have been hit.
	var (
		downOverflow, upOverflow     int
		productExceeds256ButFits     int
		roundedUpDiffersFromRoundedD int
		zeroDivisor                  int
	)

	for i := 0; i < diffIterations; i++ {
		a, b, d := randBiased(r), randBiased(r), randBiased(r)
		ba, bb, bd := toBig(a), toBig(b), toBig(d)
		prod := new(big.Int).Mul(ba, bb)

		if bd.Sign() == 0 {
			if _, err := MulDivDownErr(a, b, d); err == nil {
				t.Fatalf("MulDivDownErr(%s,%s,0) want ErrDivByZero", a, b)
			}
			if _, err := MulDivUpErr(a, b, d); err == nil {
				t.Fatalf("MulDivUpErr(%s,%s,0) want ErrDivByZero", a, b)
			}
			zeroDivisor++
			continue
		}

		exactQ := new(big.Int).Quo(prod, bd)
		exactR := new(big.Int).Rem(prod, bd)
		wantDown := exactQ
		wantUp := new(big.Int).Set(exactQ)
		if exactR.Sign() != 0 {
			wantUp.Add(wantUp, big.NewInt(1))
		}

		gotDown, errDown := MulDivDownErr(a, b, d)
		if wantDown.Cmp(big2to256) < 0 {
			if errDown != nil {
				t.Fatalf("MulDivDownErr(%s,%s,%s) unexpected error: %v", a, b, d, errDown)
			}
			if gotDown != fromBig(t, wantDown) {
				t.Fatalf("MulDivDownErr(%s,%s,%s) = %s, want %v", a, b, d, gotDown, wantDown)
			}
			if prod.Cmp(big2to256) >= 0 {
				productExceeds256ButFits++
			}
		} else {
			if errDown == nil {
				t.Fatalf("MulDivDownErr(%s,%s,%s) = %v, want ErrOverflow", a, b, d, gotDown)
			}
			downOverflow++
		}

		gotUp, errUp := MulDivUpErr(a, b, d)
		if wantUp.Cmp(big2to256) < 0 {
			if errUp != nil {
				t.Fatalf("MulDivUpErr(%s,%s,%s) unexpected error: %v", a, b, d, errUp)
			}
			if gotUp != fromBig(t, wantUp) {
				t.Fatalf("MulDivUpErr(%s,%s,%s) = %s, want %v", a, b, d, gotUp, wantUp)
			}
		} else {
			if errUp == nil {
				t.Fatalf("MulDivUpErr(%s,%s,%s) = %v, want ErrOverflow", a, b, d, gotUp)
			}
			upOverflow++
		}

		if wantUp.Cmp(wantDown) != 0 {
			roundedUpDiffersFromRoundedD++
		}
	}

	if zeroDivisor == 0 {
		t.Errorf("never exercised a zero divisor")
	}
	if downOverflow == 0 || upOverflow == 0 {
		t.Errorf("never exercised quotient overflow (down=%d up=%d)", downOverflow, upOverflow)
	}
	if productExceeds256ButFits == 0 {
		t.Errorf("never exercised a product > 2^256-1 with a representable quotient; " +
			"this is the exact case File 19:60 forbids rejecting")
	}
	if roundedUpDiffersFromRoundedD == 0 {
		t.Errorf("never observed a non-zero remainder, so rounding direction is untested")
	}
}
