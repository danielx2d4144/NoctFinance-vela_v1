package noctmath

import (
	"errors"
	"math/big"
	"strings"
	"testing"
)

// TestEncodingRoundTrip verifies that all four representations agree: the
// in-memory limbs, the 32-byte big-endian wire form, the canonical hex string
// and the decimal string. A mismatch between any pair would let the same integer
// hash differently on different sides of the host/guest boundary.
func TestEncodingRoundTrip(t *testing.T) {
	r := newRand()
	for i := 0; i < diffIterations; i++ {
		z := randBiased(r)

		b32 := z.ToBytes32()
		if got := fromBytes32(b32); got != z {
			t.Fatalf("bytes32 round trip: %s -> %x -> %s", z, b32, got)
		}

		hex := z.ToHex()
		if len(hex) != 66 {
			t.Fatalf("ToHex(%s) = %q, want exactly 66 chars", z, hex)
		}
		if !strings.HasPrefix(hex, "0x") {
			t.Fatalf("ToHex(%s) = %q, want a 0x prefix", z, hex)
		}
		if hex != strings.ToLower(hex) {
			t.Fatalf("ToHex(%s) = %q, want lowercase canonical form", z, hex)
		}
		got, err := FromHex(hex)
		if err != nil {
			t.Fatalf("FromHex(%q): %v", hex, err)
		}
		if got != z {
			t.Fatalf("hex round trip: %s -> %s -> %s", z, hex, got)
		}

		// The hex body must equal the big-endian bytes, which independently ties
		// the two wire forms together.
		wantBody := new(big.Int).SetBytes(b32[:]).Text(16)
		wantBody = strings.Repeat("0", 64-len(wantBody)) + wantBody
		if hex[2:] != wantBody {
			t.Fatalf("ToHex body %q != big-endian bytes %q", hex[2:], wantBody)
		}

		if dec := z.String(); dec != toBig(z).String() {
			t.Fatalf("String() = %q, want %q", dec, toBig(z).String())
		}
	}
}

func TestEncodingKnownValues(t *testing.T) {
	cases := []struct {
		z   U256
		hex string
		dec string
	}{
		{Zero(), "0x0000000000000000000000000000000000000000000000000000000000000000", "0"},
		{One(), "0x0000000000000000000000000000000000000000000000000000000000000001", "1"},
		{FromUint64(255), "0x00000000000000000000000000000000000000000000000000000000000000ff", "255"},
		{Wad(), "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000", "1000000000000000000"},
		{
			MaxU256(),
			"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
			"115792089237316195423570985008687907853269984665640564039457584007913129639935",
		},
		{
			// A distinct value in every limb, so a limb-ordering bug cannot cancel
			// out. At 78 decimal digits this is also the widest String() output
			// possible, which pins the decimal buffer sizing.
			U256{0x0123456789abcdef, 0xfedcba9876543210, 0x0f0f0f0f0f0f0f0f, 0xf0f0f0f0f0f0f0f0},
			"0xf0f0f0f0f0f0f0f00f0f0f0f0f0f0f0ffedcba98765432100123456789abcdef",
			"108980789870415242746057602006365077305894218879387680758770315066898425564655",
		},
	}

	for _, tc := range cases {
		if got := tc.z.ToHex(); got != tc.hex {
			t.Errorf("ToHex = %s, want %s", got, tc.hex)
		}
		if got := tc.z.String(); got != tc.dec {
			t.Errorf("String = %s, want %s", got, tc.dec)
		}
		parsed, err := FromHex(tc.hex)
		if err != nil {
			t.Errorf("FromHex(%s): %v", tc.hex, err)
			continue
		}
		if parsed != tc.z {
			t.Errorf("FromHex = %s, want %s", parsed, tc.z)
		}
	}
}

func TestUint64Narrowing(t *testing.T) {
	if v, ok := FromUint64(42).Uint64(); !ok || v != 42 {
		t.Fatalf("Uint64() = %d, %v; want 42, true", v, ok)
	}
	if v, ok := MaxU256().Uint64(); ok {
		t.Fatalf("Uint64(max) reported ok=true with %d; narrowing must fail", v)
	}
	// A value whose low limb is small but whose high limb is set must still fail.
	// This is exactly the silent-truncation shape of DEMO-01.
	wide := U256{1, 0, 0, 1}
	if v, ok := wide.Uint64(); ok {
		t.Fatalf("Uint64(%s) reported ok=true with %d", wide, v)
	}
}

// TestFromHexRejectsMalformed pins the strictness of the trust boundary. Silent
// leniency here is how malformed host input becomes a consensus split.
func TestFromHexRejectsMalformed(t *testing.T) {
	bad := []string{
		"",
		"0x",
		"0X",
		"0x" + strings.Repeat("0", 65), // one digit too long
		strings.Repeat("f", 65),        // one digit too long, no prefix
		"0x12 34",                      // embedded space
		" 0x12",                        // leading space
		"0x12 ",                        // trailing space
		"+0x12",                        // explicit sign
		"-0x12",                        // negative
		"0xg",                          // not a hex digit
		"0xdeadbeefg",                  // trailing non-hex
		"12.0",                         // decimal point
		"0x1_2",                        // separator
	}

	for _, s := range bad {
		got, err := FromHex(s)
		if err == nil {
			t.Errorf("FromHex(%q) = %s, want ErrInvalidEncoding", s, got)
			continue
		}
		if !errors.Is(err, ErrInvalidEncoding) {
			t.Errorf("FromHex(%q) err = %v, want ErrInvalidEncoding", s, err)
		}
	}

	good := map[string]U256{
		"0xff":                         FromUint64(255),
		"0XFF":                         FromUint64(255),
		"ff":                           FromUint64(255),
		"0x0000000000ff":               FromUint64(255),
		"0x" + strings.Repeat("f", 64): MaxU256(),
		// "1e3" is valid hexadecimal, not scientific notation. Pinned explicitly so
		// nobody later "fixes" the parser into rejecting it or, worse, into
		// interpreting it as one thousand.
		"1e3": FromUint64(483),
	}
	for s, want := range good {
		got, err := FromHex(s)
		if err != nil {
			t.Errorf("FromHex(%q) unexpected error: %v", s, err)
			continue
		}
		if got != want {
			t.Errorf("FromHex(%q) = %s, want %s", s, got, want)
		}
	}
}

func TestShifts(t *testing.T) {
	r := newRand()
	for i := 0; i < 2000; i++ {
		z := randBiased(r)
		n := uint(r.Intn(300)) // deliberately exceeds 256 sometimes

		wantShr := new(big.Int).Rsh(toBig(z), n)
		if got := z.Shr(n); got != fromBig(t, wantShr) {
			t.Fatalf("(%s).Shr(%d) = %s, want %v", z, n, got, wantShr)
		}

		wantShl := new(big.Int).Lsh(toBig(z), n)
		got, err := z.Shl(n)
		if wantShl.Cmp(big2to256) >= 0 {
			if !errors.Is(err, ErrOverflow) {
				t.Fatalf("(%s).Shl(%d) = %s, %v; want ErrOverflow", z, n, got, err)
			}
			continue
		}
		if err != nil {
			t.Fatalf("(%s).Shl(%d) unexpected error: %v", z, n, err)
		}
		if got != fromBig(t, wantShl) {
			t.Fatalf("(%s).Shl(%d) = %s, want %v", z, n, got, wantShl)
		}
	}
}

func TestBitLenAndCmp(t *testing.T) {
	if got := Zero().BitLen(); got != 0 {
		t.Fatalf("BitLen(0) = %d, want 0", got)
	}
	if got := One().BitLen(); got != 1 {
		t.Fatalf("BitLen(1) = %d, want 1", got)
	}
	if got := MaxU256().BitLen(); got != 256 {
		t.Fatalf("BitLen(max) = %d, want 256", got)
	}
	r := newRand()
	for i := 0; i < diffIterations; i++ {
		a, b := randBiased(r), randBiased(r)
		if got, want := a.BitLen(), toBig(a).BitLen(); got != want {
			t.Fatalf("BitLen(%s) = %d, want %d", a, got, want)
		}
		if got, want := a.Cmp(b), toBig(a).Cmp(toBig(b)); got != want {
			t.Fatalf("Cmp(%s, %s) = %d, want %d", a, b, got, want)
		}
	}
}

// TestQuantizationDifferential checks the File 08 boundary helpers against
// math/big across the same value distribution as the arithmetic tests.
func TestQuantizationDifferential(t *testing.T) {
	r := newRand()
	for i := 0; i < diffIterations; i++ {
		w := randBiased(r)
		nd := uint(r.Intn(19)) // 0..18, always valid

		q, err := Quantum(nd)
		if err != nil {
			t.Fatalf("Quantum(%d): %v", nd, err)
		}
		bq := toBig(q)
		bw := toBig(w)

		units := new(big.Int).Quo(bw, bq)
		rem := new(big.Int).Rem(bw, bq)

		// WadToNative floors to whole native units.
		if got, err := WadToNative(w, nd); err != nil || got != fromBig(t, units) {
			t.Fatalf("WadToNative(%s,%d) = %s, %v; want %v", w, nd, got, err, units)
		}

		// QuantizeDown = units * quantum, and never exceeds the input.
		wantDown := new(big.Int).Mul(units, bq)
		gotDown, err := QuantizeDown(w, nd)
		if err != nil || gotDown != fromBig(t, wantDown) {
			t.Fatalf("QuantizeDown(%s,%d) = %s, %v; want %v", w, nd, gotDown, err, wantDown)
		}
		if gotDown.Cmp(w) > 0 {
			t.Fatalf("QuantizeDown(%s,%d) = %s exceeds the input", w, nd, gotDown)
		}

		// RoundUpToQuantum = ceil(w/quantum)*quantum, and never below the input.
		wantUp := new(big.Int).Set(units)
		if rem.Sign() != 0 {
			wantUp.Add(wantUp, big.NewInt(1))
		}
		wantUp.Mul(wantUp, bq)
		gotUp, err := RoundUpToQuantum(w, nd)
		if err != nil {
			// Only legitimate failure is overflow when units+1 does not fit.
			if !errors.Is(err, ErrOverflow) || wantUp.Cmp(big2to256) < 0 {
				t.Fatalf("RoundUpToQuantum(%s,%d) err = %v (want fits=%v)", w, nd, err, wantUp.Cmp(big2to256) < 0)
			}
			continue
		}
		if gotUp != fromBig(t, wantUp) {
			t.Fatalf("RoundUpToQuantum(%s,%d) = %s; want %v", w, nd, gotUp, wantUp)
		}
		if gotUp.Cmp(w) < 0 {
			t.Fatalf("RoundUpToQuantum(%s,%d) = %s is below the input", w, nd, gotUp)
		}

		// Representability must agree with a zero remainder.
		ok, err := IsNativeRepresentable(w, nd)
		if err != nil {
			t.Fatalf("IsNativeRepresentable(%s,%d): %v", w, nd, err)
		}
		if ok != (rem.Sign() == 0) {
			t.Fatalf("IsNativeRepresentable(%s,%d) = %v, want %v", w, nd, ok, rem.Sign() == 0)
		}

		// Quantized results must always be representable.
		if ok, _ := IsNativeRepresentable(gotDown, nd); !ok {
			t.Fatalf("QuantizeDown result %s is not representable at %d decimals", gotDown, nd)
		}
		if ok, _ := IsNativeRepresentable(gotUp, nd); !ok {
			t.Fatalf("RoundUpToQuantum result %s is not representable at %d decimals", gotUp, nd)
		}
	}
}
