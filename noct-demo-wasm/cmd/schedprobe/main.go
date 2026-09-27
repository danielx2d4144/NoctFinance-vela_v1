// Command schedprobe determines the minimal TinyGo scheduler configuration that
// the noctmath guest can be built with.
//
// This is not redundant scaffolding. TinyGo 0.42 targeting wasi has exactly one
// working scheduler that supports goroutines (asyncify), and asyncify requires
// the module to be transformed by binaryen's `wasm-opt --asyncify` pass. A
// verification-only wasm-opt stub that copies the module unchanged therefore
// produces something that compiles but cannot run. Knowing whether the guest can
// be built with `-scheduler=none` is what decides if that matters at all.
//
// The probe writes directly through syscall rather than fmt/os, because fmt and
// os reach time.Sleep, which fails to link under -scheduler=none.
package main

import (
	"syscall"

	"github.com/noctfinance/noct-demo-wasm/noctmath"
)

func write(s string) {
	_, _ = syscall.Write(1, []byte(s))
}

func main() {
	wad := noctmath.Wad()

	sum, err := wad.Add(wad)
	write("add_ok=")
	write(sum.String())
	write(" err=")
	if err != nil {
		write(err.Error())
	} else {
		write("nil")
	}
	write("\n")

	// Full-width mulDiv: product is 2^400, quotient representable.
	one := noctmath.One()
	p200, _ := one.Shl(200)
	wide, err := noctmath.MulDivDownErr(p200, p200, p200)
	write("muldiv_wide=")
	write(wide.String())
	if err != nil {
		write(" UNEXPECTED_ERR")
	}
	write("\n")

	// Every failure mode must come back as a value, never as a trap.
	if _, e := noctmath.MaxU256().Mul(noctmath.MaxU256()); e != nil {
		write("mul_overflow=ERR:")
		write(e.Error())
		write("\n")
	}
	if _, e := noctmath.Zero().Sub(one); e != nil {
		write("sub_underflow=ERR:")
		write(e.Error())
		write("\n")
	}
	if _, e := wad.Div(noctmath.Zero()); e != nil {
		write("div_by_zero=ERR:")
		write(e.Error())
		write("\n")
	}

	down, _ := noctmath.QuantizeDown(noctmath.FromUint64(1234567890123456789), 6)
	up, _ := noctmath.RoundUpToQuantum(noctmath.FromUint64(1234567890123456789), 6)
	write("quantize_down=")
	write(down.String())
	write("\nround_up=")
	write(up.String())
	write("\nDONE\n")
}
