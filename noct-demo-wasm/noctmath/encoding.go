package noctmath

const lowerHex = "0123456789abcdef"

// ToBytes32 encodes z as exactly 32 unsigned big-endian bytes, the wire form
// required by File 09:20 and File 10:23 ("exactly 32 unsigned big-endian
// bytes"). z[3] maps to b[0..7] and z[0] to b[24..31].
func (z U256) ToBytes32() [32]byte {
	var b [32]byte
	for i := 0; i < 4; i++ {
		v := z[i]
		base := 32 - 8*(i+1)
		for j := 0; j < 8; j++ {
			b[base+7-j] = byte(v & 0xff)
			v >>= 8
		}
	}
	return b
}

// FromBytes32 decodes exactly 32 unsigned big-endian bytes. This direction is
// total: every 32-byte string is a valid U256, so it cannot fail.
func fromBytes32(b [32]byte) U256 {
	var z U256
	for i := 0; i < 4; i++ {
		base := 32 - 8*(i+1)
		var v uint64
		for j := 0; j < 8; j++ {
			v = v<<8 | uint64(b[base+j])
		}
		z[i] = v
	}
	return z
}

// ToHex returns the canonical encoding: "0x" followed by exactly 64 lowercase
// hex digits, zero-padded.
//
// Canonicality matters because this form feeds commitments and the
// host/guest/TypeScript boundary. A variable-width encoding would let two
// different strings denote the same integer and therefore produce different
// hashes for identical state. Anything hashed or committed MUST use this
// function rather than formatting the value ad hoc.
func (z U256) ToHex() string {
	var buf [66]byte
	buf[0] = '0'
	buf[1] = 'x'
	for i := 3; i >= 0; i-- {
		v := z[i]
		base := 2 + (3-i)*16
		for j := 15; j >= 0; j-- {
			buf[base+j] = lowerHex[v&0xf]
			v >>= 4
		}
	}
	return string(buf[:])
}

// FromHex decodes a hex string with an optional "0x"/"0X" prefix and between 1
// and 64 hex digits, upper or lower case.
//
// It returns ErrInvalidEncoding for an empty digit string, more than 64 digits,
// or any non-hex character. It deliberately does NOT accept a sign, whitespace,
// underscores or a decimal string: silent leniency at a trust boundary is how
// malformed host input becomes a consensus split.
func FromHex(s string) (U256, error) {
	if len(s) >= 2 && s[0] == '0' && (s[1] == 'x' || s[1] == 'X') {
		s = s[2:]
	}
	if len(s) == 0 || len(s) > 64 {
		return uZero, ErrInvalidEncoding
	}
	var z U256
	for k := 0; k < len(s); k++ {
		c := s[k]
		var v uint64
		switch {
		case c >= '0' && c <= '9':
			v = uint64(c - '0')
		case c >= 'a' && c <= 'f':
			v = uint64(c-'a') + 10
		case c >= 'A' && c <= 'F':
			v = uint64(c-'A') + 10
		default:
			return uZero, ErrInvalidEncoding
		}
		pos := uint(len(s) - 1 - k) // nibble index, 0 == least significant
		z[pos/16] |= v << ((pos % 16) * 4)
	}
	return z, nil
}

// String returns the decimal representation of z, without leading zeros. It
// exists for logs, error messages and golden-vector readability.
//
// It is written without fmt or strconv to keep the wasm guest small and to avoid
// pulling locale or reflection machinery into the TEE binary. The buffer is
// sized for the worst case (2^256-1 has 78 decimal digits) so it cannot be
// overrun.
func (z U256) String() string {
	if z.IsZero() {
		return "0"
	}
	// Split into base-1e18 groups. 2^256 < 1e78, so at most five groups.
	const chunk = uint64(1000000000000000000)
	cU := FromUint64(chunk)

	var groups [5]uint64
	ng := 0
	n := z
	for ng < len(groups) {
		q, rem, err := n.QuoRem(cU)
		if err != nil {
			// Unreachable: the divisor is a fixed non-zero constant, so the only
			// possible failure mode is a bug in this package. Emitting a partial
			// but valid string is preferable to panicking inside a TEE guest.
			break
		}
		// rem < 1e18, which always fits in the low limb.
		groups[ng] = rem[0]
		ng++
		if q.IsZero() {
			break
		}
		n = q
	}

	var buf [96]byte
	pos := len(buf)
	// The buffer is filled from the right, so the least significant group must be
	// written first and only the most significant group -- written last, at the
	// left edge -- goes unpadded.
	for i := 0; i < ng; i++ {
		g := groups[i]
		width := 18
		if i == ng-1 {
			width = digits10(g)
		}
		for k := 0; k < width; k++ {
			pos--
			buf[pos] = byte('0' + g%10)
			g /= 10
		}
	}
	return string(buf[pos:])
}

// digits10 returns the number of decimal digits in v, with 0 counting as one.
func digits10(v uint64) int {
	if v == 0 {
		return 1
	}
	n := 0
	for v > 0 {
		n++
		v /= 10
	}
	return n
}
