<#
.SYNOPSIS
  Canonical, pinned build and verification of the Noct Finance V1 Vela guest.

.DESCRIPTION
  This is the Windows-native equivalent of noct-demo-wasm/build.sh, and it exists
  because build.sh cannot run on this host without a POSIX shell. Its absence was
  the root cause of the false artifact evidence found on Day 1: builds were issued
  by invoking a bare `tinygo` from PATH, which on this machine resolves to
  TinyGo 0.42.0 paired with the SYSTEM Go 1.27.1 rather than the pinned
  TinyGo 0.39.0 + Go 1.24.0. Under that unpinned pair, -scheduler=none fails to
  link (time/sleep.go: "attempted to start a goroutine without a scheduler"),
  which silently forced the asyncify scheduler and produced a module that imports
  asyncify host functions. That asyncify module was then recorded as guest
  evidence, contradicting TOOLCHAIN-LOCK.md.

  The fix is not to strip fmt/os/encoding/json from the guest. Under the correctly
  paired pinned toolchain the guest links cleanly with -scheduler=none and imports
  no asyncify functions at all, so the JSON/fmt code is not the problem and does
  not need to be rewritten. The problem was purely that nothing enforced the pair.

  This script therefore asserts the toolchain pairing before building, builds with
  the mandated flags, and then gates the artifact on its actual import table so a
  regression to asyncify fails the build instead of shipping.

.NOTES
  Mandated build (TOOLCHAIN-LOCK.md):
    -target=wasi -no-debug -scheduler=none -gc=conservative
  The stub wasm-opt is acceptable for these verification builds only because
  -scheduler=none needs no Asyncify transform. A RELEASE artifact MUST be rebuilt
  with real binaryen wasm-opt before deployment.
#>
[CmdletBinding()]
param(
    # Skip executing the probe module under WASI (e.g. when node is unavailable).
    [switch]$SkipRun,
    # Build into a scratch directory instead of overwriting artifacts/.
    [switch]$DryRun,
    # Assert this is a release build: requires real binaryen wasm-opt and refuses
    # to publish the deployable artifact from the verification stub.
    [switch]$Release
)

$ErrorActionPreference = 'Stop'

$repo    = Split-Path -Parent $PSScriptRoot
$wasmDir = Join-Path $repo 'noct-demo-wasm'
$outDir  = if ($DryRun) { Join-Path $repo 'artifacts\dryrun' } else { Join-Path $repo 'artifacts' }

# --- pinned toolchain -------------------------------------------------------
# These are asserted, never assumed. The pairing is the point: TinyGo 0.39.0
# resolves its GOROOT from the environment, so a correct TinyGo against a wrong Go
# still produces a wrong artifact while reporting a correct TinyGo version.
$TINYGO_REQUIRED = '0.39.0'
$GO_REQUIRED     = '1.24.0'

$goExe     = Join-Path $repo 'tools\go124\go\bin\go.exe'
$tinygoExe = Join-Path $repo 'tools\tg039\tinygo\bin\tinygo.exe'
$stubExe   = Join-Path $repo 'tools\wasmoptstub.exe'

# Fail writes to stderr and exits without raising. Write-Error under
# ErrorActionPreference='Stop' becomes a terminating exception that PowerShell
# renders as a multi-screen NativeCommandError dump, burying the real diagnostic.
function Fail([string]$msg, [int]$code = 1) {
    [Console]::Error.WriteLine("ERROR: $msg")
    exit $code
}

function Step([string]$msg) { Write-Host "==> $msg" }

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Step "repository root: $repo"

foreach ($p in @($goExe, $tinygoExe)) {
    if (-not (Test-Path $p)) {
        Fail "pinned toolchain component missing: $p`nInstall the pinned pair into tools/ (see TOOLCHAIN-LOCK.md). Do NOT fall back to a system tinygo or go: that pairing cannot build this guest with -scheduler=none." 2
    }
}

# --- pin the environment ----------------------------------------------------
# GOROOT is set explicitly rather than inherited. Inheriting it is what let the
# pinned TinyGo bind to the system Go 1.27.1 and silently produce an asyncify
# module while still reporting "tinygo version 0.39.0".
$env:GOROOT      = Join-Path $repo 'tools\go124\go'
$env:GOTOOLCHAIN = 'local'
$env:PATH        = (Join-Path $env:GOROOT 'bin') + [IO.Path]::PathSeparator + $env:PATH

# --- assert versions --------------------------------------------------------
Step 'asserting pinned toolchain versions'

$goVerRaw = (& $goExe version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { Fail "go version failed: $goVerRaw" 2 }
if ($goVerRaw -notmatch "go$([regex]::Escape($GO_REQUIRED))\b") {
    Fail "pinned Go is not $GO_REQUIRED. Reported: $goVerRaw" 2
}
Write-Host "    go:     $goVerRaw"

$tgVerRaw = (& $tinygoExe version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { Fail "tinygo version failed: $tgVerRaw" 2 }
if ($tgVerRaw -notmatch "tinygo version $([regex]::Escape($TINYGO_REQUIRED))\b") {
    Fail "pinned TinyGo is not $TINYGO_REQUIRED. Reported: $tgVerRaw" 2
}

# The decisive assertion: the Go that TinyGo itself resolved. A correct TinyGo
# version string with the wrong embedded Go is exactly the failure mode that
# produced the false asyncify evidence, so it is checked here and nowhere later.
if ($tgVerRaw -notmatch "using go version go$([regex]::Escape($GO_REQUIRED))\b") {
    Fail @"
TinyGo $TINYGO_REQUIRED did not bind to the pinned Go $GO_REQUIRED.
  reported: $tgVerRaw
  GOROOT was set to: $env:GOROOT
This is the pairing that makes -scheduler=none linkable. Building anyway would
silently fall back to the asyncify scheduler and produce a module that links but
cannot be instantiated in the Vela executor.
"@ 2
}
Write-Host "    tinygo: $tgVerRaw"
$tgVerRaw | Set-Content -LiteralPath (Join-Path $outDir 'tg039_version.txt') -Encoding ascii

# --- wasm-opt ---------------------------------------------------------------
# TinyGo invokes wasm-opt unconditionally for every wasm target. Prefer real
# binaryen; otherwise build the in-repo verification stub. The stub copies the
# module unchanged, which is safe HERE ONLY because -scheduler=none produces no
# Asyncify instrumentation to apply.
Step 'resolving wasm-opt'

# Provenance is determined by asking the binary what it is, never by its file
# name or PATH position. A stub copied onto PATH as `wasm-opt` otherwise reports
# itself as real binaryen, which is exactly the false-provenance failure this
# script exists to prevent.
function Get-WasmOptProvenance([string]$path) {
    try { $v = (& $path --version 2>&1 | Out-String).Trim() } catch { $v = '' }
    if ($v -match 'wasmoptstub|NOT binaryen') { return 'stub' }
    if ($v -match 'wasm-opt version \d+')      { return 'real' }
    return 'unknown'
}

$resolved    = Get-Command 'wasm-opt' -ErrorAction SilentlyContinue
$wasmOptMode = $null

if ($resolved) {
    switch (Get-WasmOptProvenance $resolved.Source) {
        'real' {
            $env:WASMOPT = $resolved.Source
            $wasmOptMode = 'real-binaryen'
            Write-Host "    real binaryen: $($resolved.Source)"
        }
        'stub' {
            # The in-repo stub is shadowing the binaryen name on PATH. Use it, but
            # say so plainly: a release build must not inherit this silently.
            Write-Warning "a verification-only stub is on PATH as 'wasm-opt' ($($resolved.Source)). It is NOT binaryen. Remove tools\wasmoptstub from PATH for release builds."
            $env:WASMOPT = $resolved.Source
            $wasmOptMode = 'stub-verification-only'
        }
        default {
            Fail "a binary named wasm-opt was found at $($resolved.Source) but does not identify itself as binaryen or as the in-repo stub. Refusing to guess its provenance." 2
        }
    }
} else {
    if (-not (Test-Path $stubExe)) {
        Step 'building verification-only wasm-opt stub'
        Push-Location (Join-Path $repo 'tools\wasmoptstub')
        try {
            & $goExe build -o $stubExe . 2>&1 | Out-String | Write-Host
            if ($LASTEXITCODE -ne 0) { Fail 'failed to build tools/wasmoptstub' 2 }
        } finally { Pop-Location }
    }
    $env:WASMOPT = $stubExe
    $wasmOptMode = 'stub-verification-only'
    Write-Warning "real binaryen wasm-opt not found; using the VERIFICATION-ONLY stub ($stubExe). Acceptable for -scheduler=none verification builds. A RELEASE artifact MUST be rebuilt with real binaryen."
}

# A release build is defined by TOOLCHAIN-LOCK.md as one produced with real
# binaryen. Enforce that mechanically instead of trusting the operator to remember.
if ($Release -and $wasmOptMode -ne 'real-binaryen') {
    Fail "-Release was requested but wasm-opt resolved to '$wasmOptMode'. TOOLCHAIN-LOCK.md permits the stub for -scheduler=none verification only; a release artifact must be optimised by real binaryen so the shipped bytes match what was measured. Install binaryen and re-run, or drop -Release." 2
}

# --- builds -----------------------------------------------------------------
$guestWasm = Join-Path $outDir 'guest_final.wasm'
$probeWasm = Join-Path $outDir 'probe_final.wasm'
$flags     = @('-target=wasi', '-no-debug', '-scheduler=none', '-gc=conservative')

Step "building guest with: $($flags -join ' ')"
Push-Location $wasmDir
try {
    # Native stderr must not be promoted to a terminating exception, or the
    # compiler diagnostic is lost before $LASTEXITCODE can be inspected.
    $ErrorActionPreference = 'Continue'

    # Capture-then-write rather than Tee-Object: a clean build emits nothing, and
    # Tee-Object skips creating the file on an empty pipeline, which would leave no
    # build log at all for a successful run.
    $guestOut = & $tinygoExe build -o $guestWasm @flags main.go 2>&1 | Out-String
    $guestExit = $LASTEXITCODE
    Set-Content -LiteralPath (Join-Path $outDir 'build_guest.log') -Value $guestOut -Encoding ascii

    $probeOut = & $tinygoExe build -o $probeWasm @flags ./cmd/schedprobe 2>&1 | Out-String
    $probeExit = $LASTEXITCODE
    Set-Content -LiteralPath (Join-Path $outDir 'build_probe.log') -Value $probeOut -Encoding ascii

    $ErrorActionPreference = 'Stop'
} finally { Pop-Location }

if ($guestExit -ne 0) {
    Fail "guest build failed with -scheduler=none. See artifacts/build_guest.log.`nIf the error is 'attempted to start a goroutine without a scheduler', the toolchain pairing above is wrong: TinyGo has bound to an unsupported Go, not the pinned $GO_REQUIRED."
}
if ($probeExit -ne 0) { Fail 'schedprobe build failed; see artifacts/build_probe.log' }

Step "guest: $guestWasm ($((Get-Item $guestWasm).Length) bytes)"
Step "probe: $probeWasm ($((Get-Item $probeWasm).Length) bytes)"

# --- asyncify gate ----------------------------------------------------------
# A successful compile is not evidence of a usable module. An asyncify-dependent
# module links fine and then fails to instantiate in the Vela executor, so the
# import table is inspected and the build fails if asyncify reappears.
Step 'gating on module import table'
$listImports = Join-Path $repo 'tools\listimports.js'
if (-not (Test-Path $listImports)) { Fail "missing $listImports" 2 }
if (-not (Get-Command 'node' -ErrorAction SilentlyContinue)) { Fail 'node is required for the import gate' 2 }

$gateOk = $true
foreach ($t in @(@{ n = 'guest'; p = $guestWasm; f = 'imports_guest.txt' },
                 @{ n = 'probe'; p = $probeWasm; f = 'imports_probe.txt' })) {
    $out = (& node $listImports $t.p 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { Fail "listimports failed for $($t.n)" }
    $out | Set-Content -LiteralPath (Join-Path $outDir $t.f) -Encoding ascii
    Write-Host "    [$($t.n)] $($out -replace "`r?`n", ' | ')"
    if ($out -notmatch 'asyncify=false') {
        [Console]::Error.WriteLine("ERROR: $($t.n) module imports asyncify host functions.")
        $gateOk = $false
    }
}
if (-not $gateOk) {
    Fail @"
asyncify gate FAILED. The module imports asyncify host functions, which means
-scheduler=none did not take effect and the module needs binaryen's
'wasm-opt --asyncify' transform to be runnable. A stub-built module in this state
will link and then fail to instantiate. Do not ship it.
"@
}
Step 'asyncify gate: PASS (asyncify=false for guest and probe)'

# --- runtime gate -----------------------------------------------------------
# "It compiles" is not sufficient for an arithmetic kernel whose contract is to
# return overflow and division-by-zero as values rather than trapping. Execute the
# probe under WASI and diff against the committed golden output, which also pins
# numeric agreement between the amd64 host and wasm32.
$runner = Join-Path $repo 'tools\runwasi.js'
$golden = Join-Path $wasmDir 'cmd\schedprobe\expected.txt'
$actual = Join-Path $outDir 'schedprobe_actual.txt'

if ($SkipRun) {
    Step 'runtime gate: SKIPPED (-SkipRun)'
} elseif (-not (Test-Path $runner) -or -not (Test-Path $golden)) {
    Step "runtime gate: SKIPPED (missing $runner or $golden)"
} else {
    Step 'executing probe under WASI and diffing against golden output'
    $ErrorActionPreference = 'Continue'
    & node $runner $probeWasm > $actual 2>&1
    $runExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($runExit -ne 0) {
        Get-Content $actual | Write-Host
        Fail "wasm runtime exited with code $runExit. A trap means the kernel panicked or aborted instead of returning a sentinel error, violating the no-trap contract."
    }
    function Read-Normalised([string]$path) {
        return ((Get-Content -Raw -LiteralPath $path) -replace "`r`n", "`n").TrimEnd("`n") -split "`n"
    }
    $want = Read-Normalised $golden
    $got  = Read-Normalised $actual
    $mismatch = 0
    for ($i = 0; $i -lt [Math]::Max($want.Count, $got.Count); $i++) {
        $w = if ($i -lt $want.Count) { $want[$i] } else { '<missing>' }
        $g = if ($i -lt $got.Count)  { $got[$i] }  else { '<missing>' }
        if ($w -ne $g) {
            Write-Host "    line $($i+1) MISMATCH`n      expected: $w`n      actual:   $g" -ForegroundColor Red
            $mismatch++
        }
    }
    if ($mismatch -gt 0) { Fail "runtime gate FAILED: $mismatch line(s) differ from golden output" }
    Step "runtime gate: PASS ($($got.Count) lines match golden output)"
}

# --- reproducibility --------------------------------------------------------
# Determinism is claimed by TOOLCHAIN-LOCK.md, so it is measured rather than
# asserted: rebuild the guest and require a byte-identical artifact.
Step 'reproducibility check (second independent build)'
$reWasm = Join-Path $outDir 'guest_repro.wasm'
Push-Location $wasmDir
try {
    $ErrorActionPreference = 'Continue'
    & $tinygoExe build -o $reWasm @flags main.go 2>&1 | Out-Null
    $reExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
} finally { Pop-Location }
if ($reExit -ne 0) { Fail 'reproducibility rebuild failed' }

$h1 = (Get-FileHash $guestWasm -Algorithm SHA256).Hash
$h2 = (Get-FileHash $reWasm    -Algorithm SHA256).Hash
$reproducible = ($h1 -eq $h2)
if ($reproducible) {
    Step "reproducibility: PASS (both builds SHA256 $h1)"
    Remove-Item -LiteralPath $reWasm -Force
} else {
    Write-Warning "reproducibility: FAIL. build1=$h1 build2=$h2. Keeping both artifacts for diffing."
}

# --- publish the deployable artifact ----------------------------------------
# deploy-scripts/deploy.js, quickstart.sh and demo-transaction.sh all deploy
# noct-demo-wasm/noct-demo.wasm, and 31-DEPLOYMENT-ARCHITECTURE.md defines the
# recorded WASM hash as sha256(noct-demo.wasm). That file had drifted to a
# 966,462-byte build matching NONE of the mandated flags, while the evidence files
# described a different artifact entirely -- so the deploy path is now always
# synced from the gated build and carries a provenance sidecar stating exactly how
# it was produced and whether it is release-ready.
$deployWasm   = Join-Path $wasmDir 'noct-demo.wasm'
$deployProv   = "$deployWasm.provenance.txt"
$deployHash   = $null
$deployState  = 'not-updated'

if ($DryRun) {
    Step 'deploy path: NOT updated (-DryRun)'
} else {
    Copy-Item -LiteralPath $guestWasm -Destination $deployWasm -Force
    $deployHash = (Get-FileHash $deployWasm -Algorithm SHA256).Hash
    if ($Release) {
        $deployState = 'RELEASE-READY (real binaryen)'
    } else {
        $deployState = "VERIFICATION-ONLY (wasm-opt = $wasmOptMode) -- NOT release-ready"
    }
    @"
noct-demo.wasm provenance
=========================
Generated by tools/build-guest.ps1. Do not edit by hand.

sha256        : $deployHash
bytes         : $((Get-Item $deployWasm).Length)
flags         : $($flags -join ' ')
tinygo        : $TINYGO_REQUIRED
go (GOROOT)   : $GO_REQUIRED ($env:GOROOT)
wasm-opt      : $wasmOptMode
status        : $deployState
built (UTC)   : $((Get-Date).ToUniversalTime().ToString('o'))

Identical to artifacts/guest_final.wasm, which passed the asyncify and WASI
golden-output gates in the same run. See artifacts/BUILD-EVIDENCE.md.
"@ | Set-Content -LiteralPath $deployProv -Encoding utf8

    Step "published deployable: $deployWasm ($((Get-Item $deployWasm).Length) bytes)"
    if (-not $Release) {
        Write-Warning "the published noct-demo.wasm is a VERIFICATION build ($wasmOptMode). It is runnable under -scheduler=none but is NOT the release artifact. Re-run with -Release and real binaryen before deploying."
    }
}

# --- evidence manifest ------------------------------------------------------
# artifacts/ is partially gitignored (*.wasm, *.log), so the durable record is
# written as markdown alongside the binaries it describes.
Step 'writing evidence manifest'
$hp = (Get-FileHash $probeWasm -Algorithm SHA256).Hash
$manifest = @"
# Guest build evidence

Regenerated by ``tools/build-guest.ps1``. Do not edit by hand.

## Toolchain (pinned and asserted at build time)

| Component | Required | Resolved |
|---|---|---|
| TinyGo | $TINYGO_REQUIRED | $TINYGO_REQUIRED |
| Go (GOROOT bound by TinyGo) | $GO_REQUIRED | $GO_REQUIRED |
| wasm-opt | real binaryen for release | $wasmOptMode |

``GOROOT=$env:GOROOT`` and ``GOTOOLCHAIN=local`` were set explicitly. TinyGo reports
its resolved Go in its own version string; that string is the authority on the
pairing and is recorded in ``tg039_version.txt``.

## Artifacts

| Artifact | Bytes | SHA256 | asyncify |
|---|---|---|---|
| ``guest_final.wasm`` | $((Get-Item $guestWasm).Length) | ``$h1`` | false |
| ``probe_final.wasm`` | $((Get-Item $probeWasm).Length) | ``$hp`` | false |

Build flags: ``$($flags -join ' ')``

## Deployable

``noct-demo-wasm/noct-demo.wasm`` is what ``deploy-scripts/deploy.js``,
``quickstart.sh`` and ``demo-transaction.sh`` actually upload, and
``31-DEPLOYMENT-ARCHITECTURE.md`` defines the recorded WASM hash as its sha256.
It is now synced from the gated build above rather than left to drift.

| Field | Value |
|---|---|
| SHA256 | ``$(if ($deployHash) { $deployHash } else { 'not-updated (-DryRun)' })`` |
| Status | $deployState |
| Provenance sidecar | ``noct-demo.wasm.provenance.txt`` |

## Gates

| Gate | Result |
|---|---|
| Pinned toolchain pairing (TinyGo $TINYGO_REQUIRED + Go $GO_REQUIRED) | PASS |
| ``-scheduler=none`` links cleanly | PASS |
| asyncify imports absent (guest and probe) | PASS |
| WASI golden-output runtime diff | $(if ($SkipRun) { 'SKIPPED' } else { 'PASS' }) |
| Byte-identical rebuild (determinism) | $(if ($reproducible) { 'PASS' } else { 'FAIL' }) |

## Release caveat

This build used ``wasm-opt = $wasmOptMode``. Under ``-scheduler=none`` there is no
Asyncify transform to apply, so a stub-built module is runnable and the stub is
acceptable for verification. A **release** artifact MUST still be rebuilt with real
binaryen ``wasm-opt`` so the shipped bytes match what was optimised and measured.
"@
$manifest | Set-Content -LiteralPath (Join-Path $outDir 'BUILD-EVIDENCE.md') -Encoding utf8

Step 'done'
Write-Host ''
Write-Host "guest SHA256: $h1"
Write-Host "probe SHA256: $hp"
Write-Host "evidence:     $(Join-Path $outDir 'BUILD-EVIDENCE.md')"
exit 0


