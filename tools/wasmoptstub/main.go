// Command wasmoptstub is a VERIFICATION-ONLY stand-in for binaryen's wasm-opt.
//
// TinyGo unconditionally invokes wasm-opt when building any wasm target and fails
// with "could not find wasm-opt" if it is absent. The pinned toolchain is TinyGo
// 0.39.0 (see TOOLCHAIN-LOCK.md); earlier revisions of this comment said 0.42,
// which is the unpinned system toolchain and NOT what release builds use.
// This machine has no binaryen installation. The stub satisfies that call by
// copying the input module to the output path unchanged, which lets us prove that
// TinyGo can type-check and LLVM-codegen a package to wasm.
//
// It is acceptable ONLY because the mandated build uses -scheduler=none and
// therefore needs no Asyncify transform. A release artifact MUST still be built
// with real binaryen wasm-opt.
//
// It performs NO optimization. A production or release build MUST use the real
// binaryen wasm-opt; see TOOLCHAIN-LOCK.md (OPEN item: binaryen / wasm-opt).
//
// Usage (PowerShell):
//
//	$env:WASMOPT = "<abs path>\wasmoptstub.exe"
//	tinygo build -o out.wasm -target=wasi -no-debug .
package main

import (
	"fmt"
	"io"
	"os"
)

func main() {
	args := os.Args[1:]

	// Diagnostic: record exactly how TinyGo invokes us, so the argument parser
	// can be matched to reality rather than guessed. Remove once stable.
	if dbg := os.Getenv("WASMOPTSTUB_DEBUG"); dbg != "" {
		f, err := os.OpenFile(dbg, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err == nil {
			fmt.Fprintf(f, "argc=%d\n", len(args))
			for i, a := range args {
				fmt.Fprintf(f, "  [%d] %q\n", i, a)
			}
			f.Close()
		}
	}

	var out string
	var inputs []string

	// TinyGo probes the tool before using it: `wasm-opt --version`. Emit a
	// binaryen-shaped version line so the probe succeeds. This is a lie about
	// provenance and is acceptable ONLY because the stub is verification-only
	// and never used for a release artifact.
	for _, a := range args {
		if a == "--version" || a == "-v" || a == "--help" || a == "-h" {
			fmt.Println("wasm-opt version 121 (wasmoptstub, verification-only, NOT binaryen)")
			return
		}
	}

	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "-o" || a == "--output" || a == "-oO":
			if i+1 < len(args) {
				out = args[i+1]
				i++
			}
		case len(a) > 2 && a[:2] == "-o" && a[2] != '=':
			out = a[2:]
		case len(a) > 0 && a[0] == '-':
			// Optimisation / feature flags: accepted and ignored.
			// Flags that take a value are handled below.
			if i+1 < len(args) && takesValue(a) {
				i++
			}
		default:
			inputs = append(inputs, a)
		}
	}

	if len(inputs) == 0 {
		fmt.Fprintln(os.Stderr, "wasmoptstub: no input file")
		os.Exit(1)
	}

	// wasm-opt may be invoked with several positional files; the last is the module.
	in := inputs[len(inputs)-1]

	if out == "" || out == in {
		// In-place invocation: nothing to do, the file already exists.
		return
	}

	if err := copyFile(in, out); err != nil {
		fmt.Fprintf(os.Stderr, "wasmoptstub: %v\n", err)
		os.Exit(1)
	}
}

// takesValue reports whether a wasm-opt flag consumes the following argument.
func takesValue(a string) bool {
	switch a {
	case "--input", "--output", "-i", "--mvp-features", "--all-features",
		"--enable", "--disable", "--pre", "--post", "--debuginfo",
		"--emit-es6", "--externalize":
		return true
	}
	return false
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}
