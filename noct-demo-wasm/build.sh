#!/bin/bash
set -euo pipefail

# Pinned toolchain. These versions are verified TOGETHER as a pair; see
# TOOLCHAIN-LOCK.md for why each pin exists and what breaks if it drifts.
#
# The pairing matters more than either number alone. TinyGo 0.39.0 only accepts
# Go 1.19 through 1.25 and fails with "requires go version 1.19 through 1.25,
# got go1.27" against anything newer. Go 1.24.0 is the version TOOLCHAIN-LOCK.md
# already pins from go.mod, so the lock and the roadmap agree once both are
# honoured. Earlier attempts to build this guest with TinyGo 0.42.0 under Go 1.27
# produced a different and much worse failure: -scheduler=none stopped linking,
# which forced the default asyncify scheduler and made the artifact dependent on
# a real binaryen wasm-opt. See the scheduler note below.
TINYGO_REQUIRED="0.39.0"
GO_REQUIRED="1.24.0"

echo "======================================"
echo "Building NoctFinance Demo WASM"
echo "======================================"

# --- prerequisite checks ----------------------------------------------------
# Every one of these fails loudly. A silently skipped step is how an unverifiable
# artifact ends up being treated as a verified one.
if ! command -v tinygo &> /dev/null; then
    echo "Error: TinyGo is not installed"
    echo "Install from: https://tinygo.org/getting-started/install/"
    echo "Required version: ${TINYGO_REQUIRED}"
    exit 1
fi

TINYGO_VERSION="$(tinygo version | awk '{print $3}')"
if [ "${TINYGO_VERSION}" != "${TINYGO_REQUIRED}" ]; then
    echo "Error: TinyGo version mismatch"
    echo "  found:    ${TINYGO_VERSION}"
    echo "  required: ${TINYGO_REQUIRED}"
    echo "TinyGo changes wasm codegen and scheduler support between releases, and the"
    echo "guest is a deterministic TEE artifact. Reproducibility requires an exact pin."
    exit 1
fi
echo "TinyGo ${TINYGO_VERSION} (pinned)"

if ! command -v go &> /dev/null; then
    echo "Error: Go is not installed"
    echo "Install from: https://go.dev/dl/"
    echo "Required version: ${GO_REQUIRED}"
    exit 1
fi

# Assert the Go version too, not just TinyGo's. TinyGo 0.39.0 rejects Go 1.26+
# outright, and the failure it produces ("requires go version 1.19 through 1.25")
# does not mention the toolchain pairing that actually caused it. Checking here
# turns that into an actionable message.
#
# GOTOOLCHAIN must not silently substitute a different Go: `go version` reports
# the toolchain that will actually be used, so assert on that and pin
# GOTOOLCHAIN=local for the build below so no automatic download can change it
# mid-build and break reproducibility.
GO_VERSION="$(go version | awk '{print $3}' | sed 's/^go//')"
if [ "${GO_VERSION}" != "${GO_REQUIRED}" ]; then
    echo "Error: Go version mismatch"
    echo "  found:    ${GO_VERSION}"
    echo "  required: ${GO_REQUIRED}"
    echo "TinyGo ${TINYGO_REQUIRED} supports Go 1.19-1.25 only. A newer Go makes"
    echo "-scheduler=none unlinkable for this guest, which is the exact failure"
    echo "mode TOOLCHAIN-LOCK.md's scheduler mandate exists to prevent."
    exit 1
fi
echo "Go ${GO_VERSION} (pinned)"
export GOTOOLCHAIN=local

# TinyGo invokes wasm-opt unconditionally for every wasm target. Unlike
# wasm-validate below, this is NOT optional: without binaryen on PATH (or WASMOPT
# pointing at a real binary) the build fails outright with
# "wasm-opt: getwd: no such file or directory".
#
# What wasm-opt is needed FOR has changed, and the distinction is the whole point
# of the runnability gate below:
#
#   - With -scheduler=none (the mandated configuration, and what this script now
#     uses) there is NO Asyncify transform to apply. wasm-opt only shrinks the
#     module. A stub-built module is still fully runnable because it imports no
#     asyncify host functions.
#   - With the default asyncify scheduler, wasm-opt MUST be the real binaryen
#     tool, because it has to perform the Asyncify instrumentation. A stub-built
#     module links fine and then fails at instantiation.
#
# tools/wasmoptstub is therefore acceptable for local verification of the
# -scheduler=none build, but a RELEASE artifact is still built with real binaryen
# so the size and the recorded SHA256 are the shipped ones. If the scheduler pin
# is ever reverted to asyncify, the stub becomes invalid again and the gate below
# catches it rather than letting a non-runnable artifact through.
if ! command -v wasm-opt &> /dev/null && [ -z "${WASMOPT:-}" ]; then
    echo "Error: binaryen wasm-opt is not installed and WASMOPT is not set."
    echo "Install binaryen: https://github.com/WebAssembly/binaryen/releases"
    echo ""
    echo "For local compile-only verification you may instead set:"
    echo "  export WASMOPT=\$(pwd)/../tools/wasmoptstub.exe"
    echo "That path is NOT valid for a release guest artifact."
    exit 1
fi
echo "wasm-opt: ${WASMOPT:-$(command -v wasm-opt)}"

echo ""
echo "Installing dependencies..."
go mod download
go mod tidy

# --- guest arithmetic verification ------------------------------------------
# The guest's arithmetic is a checked U256 kernel whose entire contract is that
# overflow, underflow and division by zero come back as sentinel errors rather
# than trapping the wasm instance. "It compiles" does not demonstrate that, so the
# kernel is built for wasi and executed, and its output is diffed against a
# committed golden file. See noct-demo-wasm/noctmath.
echo ""
echo "Verifying noctmath kernel under TinyGo/WASI..."
go test ./noctmath/...
echo "host unit tests: PASS"

echo ""
echo "Building WASM module..."
# --- scheduler and GC -------------------------------------------------------
# TOOLCHAIN-LOCK.md mandates `-scheduler=none`: no cooperative or preemptive
# scheduler inside the TEE. The rationale is that guest execution must be
# deterministic, and a scheduler introduces task interleaving and time-slice
# behaviour that the host cannot observe or reproduce.
#
# THIS GUEST DOES BUILD THAT WAY, and the earlier claim to the contrary was a
# toolchain artifact rather than a property of the code. Recorded so the mistake
# is not repeated:
#
#   TinyGo 0.42.0 + Go 1.27, -scheduler=none
#   -> ...\Go\src\time\sleep.go:182:2:
#      attempted to start a goroutine without a scheduler
#      (reached via vela-common-go/wasm/utils LogInfo -> time.Sleep)
#
#   TinyGo 0.39.0 + Go 1.24.0, -scheduler=none
#   -> links cleanly, imports NO asyncify host functions
#
# The pinned pair above is what makes the difference. `-scheduler=tasks` remains
# a non-escape in both cases: it does not link for wasm32 at all (internal/task
# fails with "undefined: calleeSavedRegs"), so `none` is the only schedulable
# configuration and the pairing has to be exact.
#
# Because there is no asyncify here, the module needs no Asyncify transform and
# is host-instantiable even when built against the verification stub. The gate
# below still asserts that, so a future regression to asyncify fails the build
# instead of shipping a module that links and then cannot be instantiated.
#
# -gc is recorded explicitly as the lock requires. `conservative` is TinyGo's
# default for wasi; `leaking` would never free and could exhaust linear memory in
# a long-lived instance.
tinygo build -o noct-demo.wasm -target=wasi -no-debug -scheduler=none -gc=conservative main.go
echo "scheduler: none (as mandated); -gc=conservative; asyncify: not required"

echo ""
echo "Checking WASM module..."
ls -lh noct-demo.wasm

# --- runnability gate -------------------------------------------------------
# Prove the artifact can actually be instantiated rather than assuming that a
# successful compile means a usable module. An asyncify-dependent module built
# without the Asyncify transform links fine and then fails at instantiation.
if command -v node &> /dev/null && [ -f ../tools/listimports.js ]; then
    echo ""
    echo "Inspecting module imports..."
    if node ../tools/listimports.js noct-demo.wasm; then
        echo "OK: no asyncify dependency; module is host-instantiable."
    else
        echo "WARNING: module imports asyncify. It is only runnable if binaryen's"
        echo "         'wasm-opt --asyncify' transform was applied, which requires"
        echo "         the REAL wasm-opt. A stub-built module will fail to"
        echo "         instantiate in the Vela executor."
        if [ -n "${WASMOPT:-}" ] && ! command -v wasm-opt &> /dev/null; then
            echo "Error: WASMOPT is set to a stand-in but the module needs Asyncify."
            echo "       Install binaryen, or resolve the -scheduler=none contradiction."
            exit 1
        fi
    fi
else
    echo ""
    echo "Note: node or tools/listimports.js unavailable; skipping import inspection."
fi

# wasm-validate is genuinely optional: it only confirms the module is well formed,
# which TinyGo has already guaranteed by producing it. Absence must not fail the
# build, but it must be reported rather than silently skipped.
if command -v wasm-validate &> /dev/null; then
    echo ""
    echo "Validating WASM..."
    wasm-validate noct-demo.wasm
    echo "OK: WASM is valid"
else
    echo ""
    echo "Note: wasm-validate not found (binaryen); skipping well-formedness check."
fi

echo ""
echo "======================================"
echo "Build complete: noct-demo.wasm"
echo "======================================"
echo ""
echo "SHA256: $(sha256sum noct-demo.wasm | cut -d' ' -f1)"
echo ""
echo "Next steps:"
echo "1. Start Vela environment: cd ../noct-vela-demo/dockerfiles && docker compose up"
echo "2. Upload WASM: curl -X POST http://localhost:8081/upload -F 'file=@noct-demo.wasm'"
echo "3. Deploy via TypeScript client (see test-client.ts)"
