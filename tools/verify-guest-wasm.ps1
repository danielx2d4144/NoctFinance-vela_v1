<#
.SYNOPSIS
  Verifies the noctmath checked U256 kernel under TinyGo/WASI, not just under host Go.

.DESCRIPTION
  Thin wrapper over tools/build-guest.ps1, which is now the single authority on the
  pinned toolchain and the build gates.

  This script used to resolve its own toolchain: it called a bare `tinygo` from PATH
  and documented "Requires: tinygo 0.42". On this host PATH resolves to system
  TinyGo 0.42.0 paired with Go 1.27.1, which cannot link -scheduler=none and silently
  falls back to the asyncify scheduler. That is how pre-pin evidence recording
  `total=14 asyncify=true` came to be filed against a guest that actually builds with
  `total=6 asyncify=false`. Duplicated pinning logic in two scripts is what let the
  two disagree, so it has been removed rather than corrected in place.

  The gate itself is unchanged in intent and is still worth running: host Go and
  TinyGo compile math/bits through different code paths, and TinyGo can produce a
  module that compiles but traps at runtime. For an arithmetic kernel whose entire
  purpose is to return overflow and division-by-zero as values instead of trapping,
  "it compiles" is not sufficient evidence. The golden diff also pins cross-target
  numeric agreement between amd64 and wasm32.

.PARAMETER WasmoptStub
  Retained for backwards compatibility. Ignored: build-guest.ps1 resolves wasm-opt
  itself and determines provenance by asking the binary what it is, falling back to
  the verification-only stub with a warning when real binaryen is absent.

.PARAMETER Release
  Passed through. Requires real binaryen wasm-opt and refuses to publish a
  stub-built deployable.

.NOTES
  Pinned toolchain (asserted, never assumed): TinyGo 0.39.0 + Go 1.24.0.
#>
[CmdletBinding()]
param(
    [switch]$WasmoptStub,
    [switch]$Release
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$buildGuest = Join-Path $PSScriptRoot 'build-guest.ps1'

if ($WasmoptStub) {
    Write-Warning '-WasmoptStub is ignored; tools/build-guest.ps1 resolves wasm-opt and reports its provenance itself.'
}

if (-not (Test-Path $buildGuest)) {
    [Console]::Error.WriteLine("ERROR: missing $buildGuest")
    exit 2
}

$passThru = @{}
if ($Release) { $passThru['Release'] = $true }

& $buildGuest @passThru
exit $LASTEXITCODE

