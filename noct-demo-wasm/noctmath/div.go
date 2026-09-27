package noctmath

import "math/bits"

// u512 is an eight-limb little-endian unsigned integer, used only as the
// full-width intermediate required by mulDivDown/mulDivUp. It is unexported on
// purpose: File 19:60 requires the double-width product to exist, but nothing
// outside this package may observe or depend on a 512-bit value, because no
// balance, debt, amount or commitment ever leaves the 256-bit domain.
type u512 [8]uint64

// mul512 returns the exact 512-bit product of two U256 values. It never
// overflows and never fails: a 256x256 product always fits in 512 bits.
//
// Schoolbook multiplication, one outer pass per limb of a. The carry algebra is
// arranged so every intermediate provably fits in a uint64:
//
//   - hi from bits.Mul64 is at most 2^64-2, so absorbing the incoming carry c1
//     cannot overflow;
//   - when the final Add64 reports carry-out c3 == 1 the running hi has wrapped
//     to exactly 0, so hi+c3 == 1 and cannot overflow either.
func mul512(a, b U256) u512 {
	var r u512
	for i := 0; i < 4; i++ {
		var carry uint64
		if a[i] != 0 {
			for j := 0; j < 4; j++ {
				hi, lo := bits.Mul64(a[i], b[j])
				lo, c1 := bits.Add64(lo, carry, 0)
				hi, _ = bits.Add64(hi, 0, c1)
				sum, c2 := bits.Add64(r[i+j], lo, 0)
				hi, c3 := bits.Add64(hi, 0, c2)
				r[i+j] = sum
				carry = hi + c3
			}
		}
		// Limb i+4 has not been touched by any earlier outer pass, so assigning
		// the carry is correct and needs no accumulate.
		r[i+4] = carry
	}
	return r
}

// isZero reports whether u == 0.
func (u u512) isZero() bool {
	return u[0]|u[1]|u[2]|u[3]|u[4]|u[5]|u[6]|u[7] == 0
}

// bitLen returns the number of bits needed to represent u, or 0 if u == 0.
func (u u512) bitLen() int {
	for i := 7; i >= 0; i-- {
		if u[i] != 0 {
			return i*64 + bits.Len64(u[i])
		}
	}
	return 0
}

// toU256 narrows u to 256 bits, returning ErrOverflow if it does not fit. This
// is the single choke point through which every 512-bit result must pass, so the
// rule of File 19:60 -- a quotient may be representable even when the product is
// not -- is enforced in exactly one place.
func (u u512) toU256() (U256, error) {
	if u[4]|u[5]|u[6]|u[7] != 0 {
		return uZero, ErrOverflow
	}
	return U256{u[0], u[1], u[2], u[3]}, nil
}

// cmp512 returns -1, 0 or +1 as a is less than, equal to, or greater than b.
func cmp512(a, b u512) int {
	for i := 7; i >= 0; i-- {
		if a[i] != b[i] {
			if a[i] > b[i] {
				return 1
			}
			return -1
		}
	}
	return 0
}

// sub512 returns a-b and the borrow out of the most significant limb. The borrow
// is 0 when a >= b. Callers here only subtract after establishing a >= b, but
// the borrow is returned rather than discarded so the invariant stays checkable
// instead of assumed.
func sub512(a, b u512) (u512, uint64) {
	var r u512
	var borrow uint64
	for i := 0; i < 8; i++ {
		d, c1 := bits.Sub64(a[i], b[i], 0)
		d, c2 := bits.Sub64(d, borrow, 0)
		r[i] = d
		borrow = c1 + c2
	}
	return r, borrow
}

// shl512 returns u << n, discarding bits shifted past limb 7. Callers must have
// established that the result fits; quoRem512 does so via bitLen.
func shl512(u u512, n uint) u512 {
	var r u512
	if n >= 512 {
		return r
	}
	words := int(n / 64)
	shift := n % 64
	if shift == 0 {
		for i := 7; i >= words; i-- {
			r[i] = u[i-words]
		}
		return r
	}
	for i := 7; i > words; i-- {
		r[i] = u[i-words]<<shift | u[i-words-1]>>(64-shift)
	}
	r[words] = u[0] << shift
	return r
}

// shr1_512 returns u >> 1.
func shr1_512(u u512) u512 {
	var r u512
	r[7] = u[7] >> 1
	for i := 7; i > 0; i-- {
		r[i-1] = u[i]<<63 | u[i-1]>>1
	}
	return r
}

// quoRem512 divides a 512-bit numerator by a 256-bit denominator using restoring
// binary long division.
//
// It returns ErrDivByZero when den == 0 and ErrOverflow when the quotient does
// not fit in 256 bits. The remainder always fits, because rem < den <= 2^256-1.
//
// Why binary long division rather than Knuth Algorithm D: Algorithm D is faster,
// but its per-digit borrow reaches hi+c1+c2 where hi is already near 2^64-1, so
// a correct implementation needs two-word carry bookkeeping that is easy to get
// subtly wrong and hard to audit. Binary long division uses only Sub64, shifts
// and a comparison, so there is no carry algebra that can overflow at all. It
// runs in at most bitLen(quotient) <= 256 iterations. For a TEE guest performing
// a handful of mulDiv calls per state transition that is nowhere near the
// critical path, and the interface is unchanged if Algorithm D is substituted
// later as a pure optimisation.
func quoRem512(num u512, den U256) (q, r U256, err error) {
	if den == uZero {
		return uZero, uZero, ErrDivByZero
	}
	if num.isZero() {
		return uZero, uZero, nil
	}

	var d u512
	d[0], d[1], d[2], d[3] = den[0], den[1], den[2], den[3]

	nBits := num.bitLen()
	dBits := d.bitLen() // 1..256, since den != 0

	if nBits < dBits {
		// num < den: quotient 0, remainder num, which necessarily occupies
		// fewer than 256 bits.
		rem, remErr := num.toU256()
		if remErr != nil {
			return uZero, uZero, remErr
		}
		return uZero, rem, nil
	}

	// Bound the shift before looping.
	//
	// With nBits = bitLen(num) and dBits = bitLen(den), the true quotient
	// satisfies 2^(shift-1) <= q < 2^(shift+1) where shift = nBits-dBits. So:
	//
	//   shift <= 255  ->  q < 2^256, always representable;
	//   shift == 256  ->  q is in [2^255, 2^257) and MAY go either way;
	//   shift >= 257  ->  q >= 2^256, never representable.
	//
	// The shift == 256 band is why this is not simply `shift > 255`. Rejecting
	// there would discard mathematically representable quotients, which
	// File 19:60 forbids. Instead that band runs the loop and lets toU256 make
	// the decision from the actual bits.
	shift := uint(nBits - dBits)
	if shift > 256 {
		return uZero, uZero, ErrOverflow
	}

	// den << shift occupies exactly nBits <= 512 bits, so it cannot overflow.
	shifted := shl512(d, shift)
	rem := num
	var quo u512

	for i := int(shift); i >= 0; i-- {
		if cmp512(rem, shifted) >= 0 {
			// rem >= shifted, so the borrow is necessarily zero. Assert it
			// rather than assume it: a non-zero borrow would mean the comparison
			// above is wrong.
			var borrow uint64
			rem, borrow = sub512(rem, shifted)
			if borrow != 0 {
				return uZero, uZero, ErrUnderflow
			}
			quo[i/64] |= uint64(1) << (uint(i) % 64)
		}
		shifted = shr1_512(shifted)
	}

	// When shift <= 255 only limbs 0..3 of quo can have been set, so this always
	// succeeds. When shift == 256 bit 256 may land in limb 4, and narrowing
	// through toU256 is what turns a genuinely unrepresentable quotient into
	// ErrOverflow. Validating here rather than trusting the bound above keeps the
	// overflow decision derived from the actual result bits.
	if q, err = quo.toU256(); err != nil {
		return uZero, uZero, err
	}
	if r, err = rem.toU256(); err != nil {
		return uZero, uZero, err
	}
	return q, r, nil
}
