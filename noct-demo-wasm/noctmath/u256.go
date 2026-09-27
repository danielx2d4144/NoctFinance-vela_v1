package noctmath

import "math/bits"

// U256 is an unsigned 256-bit integer stored as four little-endian 64-bit
// limbs. z[0] is the least significant limb and z[3] the most significant.
//
// The zero value is numerically zero. U256 contains no pointers, so it is
// copied by value, comparable with ==, and safe to embed in state structs that
// get hash-committed.
type U256 [4]uint64

// Well-known constants are exposed as functions rather than package variables.
// A package-level `var WAD U256` is writable by any importer, and a silently
// mutated scale factor in a lending protocol is unrecoverable. Returning a copy
// costs nothing after inlining and removes the hazard entirely.
var (
	uZero = U256{0, 0, 0, 0}
	uOne  = U256{1, 0, 0, 0}
	uTen  = U256{10, 0, 0, 0}
	uMax  = U256{^uint64(0), ^uint64(0), ^uint64(0), ^uint64(0)}

	// 10^18 = 0x0de0b6b3a7640000
	uWad = U256{0x0de0b6b3a7640000, 0, 0, 0}

	// 10^27 = 0x033b2e3c9fd0803ce8000000
	uRay = U256{0x9fd0803ce8000000, 0x0000000033b2e3c, 0, 0}

	// 31_536_000, the fixed 365-day year of File 10:51.
	uSecondsPerYear = U256{0x01e13380, 0, 0, 0}
)

// Zero returns 0.
func Zero() U256 { return uZero }

// One returns 1.
func One() U256 { return uOne }

// Ten returns 10.
func Ten() U256 { return uTen }

// MaxU256 returns 2^256-1.
func MaxU256() U256 { return uMax }

// Wad returns 10^18, the single protocol fixed-point domain required by
// File 08:21-33 and File 10:31-38.
func Wad() U256 { return uWad }

// Ray returns 10^27. RAY is NOT an independent protocol domain; it is a
// risk-engine precision unit that MUST be converted back to WAD before it is
// used for any balance, debt or amount (File 08:112-132, File 10:31-38).
func Ray() U256 { return uRay }

// SecondsPerYear returns 31_536_000. Accrual MUST use this fixed 365-day year
// and MUST NOT use actual elapsed time, which is attacker-influenced
// (File 10:51-55).
func SecondsPerYear() U256 { return uSecondsPerYear }

// FromUint64 widens a uint64 into a U256. This is the only sanctioned entry
// point for Go integer types; it is lossless and cannot fail.
func FromUint64(v uint64) U256 { return U256{v, 0, 0, 0} }

// Uint64 returns the low 64 bits and reports whether the value fits. Callers
// MUST check ok; using the return value without it is how DEMO-01 happened.
func (z U256) Uint64() (v uint64, ok bool) {
	if z[1]|z[2]|z[3] != 0 {
		return z[0], false
	}
	return z[0], true
}

// IsZero reports whether z == 0.
func (z U256) IsZero() bool { return z[0]|z[1]|z[2]|z[3] == 0 }

// BitLen returns the number of bits required to represent z, i.e.
// floor(log2(z))+1, and 0 for z == 0.
func (z U256) BitLen() int {
	for i := 3; i >= 0; i-- {
		if z[i] != 0 {
			return i*64 + bits.Len64(z[i])
		}
	}
	return 0
}

// Cmp returns -1 if z < o, 0 if z == o, and +1 if z > o.
func (z U256) Cmp(o U256) int {
	for i := 3; i >= 0; i-- {
		if z[i] != o[i] {
			if z[i] > o[i] {
				return 1
			}
			return -1
		}
	}
	return 0
}

// Bit returns bit i of z as 0 or 1. Bits at index 256 and above read as 0.
func (z U256) Bit(i uint) uint64 {
	if i >= 256 {
		return 0
	}
	return (z[i/64] >> (i % 64)) & 1
}

// Add returns z+o, or ErrOverflow if the sum exceeds 2^256-1.
func (z U256) Add(o U256) (U256, error) {
	var r U256
	var c uint64
	r[0], c = bits.Add64(z[0], o[0], 0)
	r[1], c = bits.Add64(z[1], o[1], c)
	r[2], c = bits.Add64(z[2], o[2], c)
	r[3], c = bits.Add64(z[3], o[3], c)
	if c != 0 {
		return uZero, ErrOverflow
	}
	return r, nil
}

// Sub returns z-o, or ErrUnderflow if o > z. Underflow MUST be distinguished
// from a legitimate zero result: File 08:71 requires every subtraction to return
// overflow or underflow explicitly.
func (z U256) Sub(o U256) (U256, error) {
	var r U256
	var b uint64
	r[0], b = bits.Sub64(z[0], o[0], 0)
	r[1], b = bits.Sub64(z[1], o[1], b)
	r[2], b = bits.Sub64(z[2], o[2], b)
	r[3], b = bits.Sub64(z[3], o[3], b)
	if b != 0 {
		return uZero, ErrUnderflow
	}
	return r, nil
}

// Mul returns z*o, or ErrOverflow if the product exceeds 2^256-1.
//
// This is a genuine 256x256 multiply. Unlike vela-common-go's
// types.Uint256.Mul64 it never silently wraps (File 10:25, SPEC-10). Use
// MulDivDown/MulDivUp when the product may exceed 256 bits but the quotient
// after division does not.
func (z U256) Mul(o U256) (U256, error) {
	p := mul512(z, o)
	if p[4]|p[5]|p[6]|p[7] != 0 {
		return uZero, ErrOverflow
	}
	return U256{p[0], p[1], p[2], p[3]}, nil
}

// QuoRem returns the truncated quotient and remainder of z/o.
// It returns ErrDivByZero when o == 0.
func (z U256) QuoRem(o U256) (q, r U256, err error) {
	var n u512
	n[0], n[1], n[2], n[3] = z[0], z[1], z[2], z[3]
	return quoRem512(n, o)
}

// Div returns the truncated quotient z/o, or ErrDivByZero when o == 0.
func (z U256) Div(o U256) (U256, error) {
	q, _, err := z.QuoRem(o)
	return q, err
}

// Mod returns the remainder z%o, or ErrDivByZero when o == 0.
func (z U256) Mod(o U256) (U256, error) {
	_, r, err := z.QuoRem(o)
	return r, err
}

// Shr returns z shifted right by n bits. Bits shifted out are discarded, which
// is the intended floor semantics for fixed-point downscaling. Shifting by 256
// or more yields zero.
func (z U256) Shr(n uint) U256 {
	if n >= 256 {
		return uZero
	}
	words := int(n / 64)
	shift := n % 64
	var r U256
	if shift == 0 {
		for i := 0; i+words < 4; i++ {
			r[i] = z[i+words]
		}
		return r
	}
	for i := 0; i+words+1 < 4; i++ {
		r[i] = z[i+words]>>shift | z[i+words+1]<<(64-shift)
	}
	r[3-words] = z[3] >> shift
	return r
}

// Shl returns z shifted left by n bits, or ErrOverflow if any significant bit
// would be lost. It is checked because z<<n is a multiplication by 2^n, and
// File 08:39 prohibits silent wrapping.
func (z U256) Shl(n uint) (U256, error) {
	// Test representability first: z<<n fits iff bitLen(z)+n <= 256, or z is
	// zero. Checking before shifting means no intermediate can wrap.
	if !z.IsZero() && z.BitLen()+int(n) > 256 {
		return uZero, ErrOverflow
	}
	if n >= 256 {
		return uZero, nil // z is necessarily zero here
	}
	words := int(n / 64)
	shift := n % 64
	var r U256
	if shift == 0 {
		for i := 3; i >= words; i-- {
			r[i] = z[i-words]
		}
		return r, nil
	}
	for i := 3; i > words; i-- {
		r[i] = z[i-words]<<shift | z[i-words-1]>>(64-shift)
	}
	r[words] = z[0] << shift
	return r, nil
}

// Pow10 returns 10^n, or ErrOverflow if it does not fit in 256 bits. The
// largest representable power is 10^77.
func Pow10(n uint) (U256, error) {
	r := uOne
	for i := uint(0); i < n; i++ {
		var err error
		if r, err = r.Mul(uTen); err != nil {
			return uZero, ErrOverflow
		}
	}
	return r, nil
}
