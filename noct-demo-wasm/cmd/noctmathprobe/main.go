// Command noctmathprobe is a TinyGo compile-and-run probe for the noctmath
// checked U256 kernel.
//
// It exists for one reason: to prove that the kernel compiles under TinyGo for
// the WASI target and produces correct results there, not merely under the host
// Go toolchain. TinyGo supports a narrower slice of the language and standard
// library and compiles math/bits through a different code path, so host-only
// verification is not sufficient evidence for the guest.
//
// The probe prints a fixed set of KEY=value lines so the build script can diff
// them against a committed expectation without needing a test framework inside
// the guest. Errors print as ERR:<sentinel>, which is itself an assertion: the
// kernel must report overflow, underflow and division by zero as values and must
// never trap the wasm instance.
package main

import (
	"fmt"

	"github.com/noctfinance/noct-demo-wasm/noctmath"
)

// op is one checked kernel call.
type op func() (noctmath.U256, error)

// step runs a kernel operation and prints its result. The closure form is needed
// because Go only permits `f(g())` argument spreading when g() is the sole
// argument, so the two results cannot be forwarded inline alongside a name.
func step(name string, f op) {
	v, err := f()
	if err != nil {
		// A failed operation must yield the zero value, never a wrapped number.
		if !v.IsZero() {
			fmt.Printf("%s=BUG:nonzero-on-error:%s\n", name, v)
			return
		}
		fmt.Printf("%s=ERR:%v\n", name, err)
		return
	}
	fmt.Printf("%s=%s\n", name, v)
}

// must aborts on an error that the probe itself knows cannot occur. It is used
// only to construct probe inputs, never for a result under test, so a genuine
// kernel error is always reported rather than swallowed.
func must(v noctmath.U256, err error) noctmath.U256 {
	if err != nil {
		panic(err)
	}
	return v
}

// u64 is shorthand for noctmath.FromUint64, purely to keep the probe readable.
func u64(v uint64) noctmath.U256 { return noctmath.FromUint64(v) }

func main() {
	max := noctmath.MaxU256()
	one := noctmath.One()
	zero := noctmath.Zero()
	wad := noctmath.Wad()
	ray := noctmath.Ray()

	// Checked arithmetic: one success and every failure mode per operation.
	step("add_ok", func() (noctmath.U256, error) { return wad.Add(wad) })
	step("add_overflow", func() (noctmath.U256, error) { return max.Add(one) })
	step("sub_ok", func() (noctmath.U256, error) { return max.Sub(one) })
	step("sub_underflow", func() (noctmath.U256, error) { return zero.Sub(one) })
	step("mul_ok", func() (noctmath.U256, error) { return wad.Mul(wad) })
	step("mul_overflow", func() (noctmath.U256, error) { return max.Mul(max) })
	step("div_ok", func() (noctmath.U256, error) { return wad.Div(u64(3)) })
	step("div_by_zero", func() (noctmath.U256, error) { return wad.Div(zero) })

	// Full-width mulDiv. The product here is 2^400, far beyond 256 bits, yet the
	// quotient is exactly representable -- the File 19:60 requirement.
	p200 := must(one.Shl(200))
	step("muldiv_wide", func() (noctmath.U256, error) { return noctmath.MulDivDownErr(p200, p200, p200) })
	step("muldiv_down", func() (noctmath.U256, error) { return noctmath.MulDivDownErr(u64(7), one, u64(2)) })
	step("muldiv_up", func() (noctmath.U256, error) { return noctmath.MulDivUpErr(u64(7), one, u64(2)) })
	step("muldiv_by_zero", func() (noctmath.U256, error) { return noctmath.MulDivDownErr(one, one, zero) })
	step("muldiv_overflow", func() (noctmath.U256, error) { return noctmath.MulDivDownErr(max, max, one) })

	// RAY debt-index rounding. Up and down must differ by exactly one unit here,
	// which is the property that stops a borrower under-repaying.
	rayPlusOne := must(ray.Add(one))
	principal := must(u64(1000).Mul(wad))
	step("debt_up", func() (noctmath.U256, error) { return noctmath.MulDivUpErr(principal, rayPlusOne, ray) })
	step("debt_down", func() (noctmath.U256, error) { return noctmath.MulDivDownErr(principal, rayPlusOne, ray) })

	// USDC 6-decimal custody boundary.
	usdc := u64(1234567890123456789)
	step("quantum6", func() (noctmath.U256, error) { return noctmath.Quantum(6) })
	step("quantize_down", func() (noctmath.U256, error) { return noctmath.QuantizeDown(usdc, 6) })
	step("round_up", func() (noctmath.U256, error) { return noctmath.RoundUpToQuantum(usdc, 6) })
	step("to_native", func() (noctmath.U256, error) { return noctmath.WadToNative(usdc, 6) })
	step("bad_decimals", func() (noctmath.U256, error) { return noctmath.Quantum(19) })

	// Encoding. String is exercised by every line above, and deliberately avoids
	// fmt and strconv so the guest binary stays small.
	step("hex_parse", func() (noctmath.U256, error) { return noctmath.FromHex(wad.ToHex()) })
	fmt.Printf("hex_max=%s\n", max.ToHex())
	fmt.Printf("bitlen_max=%d\n", max.BitLen())
	fmt.Printf("year=%s\n", noctmath.SecondsPerYear())
}
