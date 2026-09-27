# Quarantined pre-pin evidence — DO NOT CITE

Everything in this directory was produced **before the pinned toolchain existed on
this machine**, by invoking a bare `tinygo` from PATH. On this host PATH resolves to
**TinyGo 0.42.0 + system Go 1.27.1**, not the pinned **TinyGo 0.39.0 + Go 1.24.0**.

These files are retained as an audit trail only. They are **false evidence** for the
current guest and must not be quoted in TOOLCHAIN-LOCK.md, the roadmap, or any
deployment readiness claim.

## Why they are wrong

Under the unpinned pair, `-scheduler=none` fails to link:

    C:\Program Files\Go\src\time\sleep.go:182:2:
      attempted to start a goroutine without a scheduler

The error path is `C:\Program Files\Go` — the **system** Go 1.27.1 — which is the
tell. TinyGo then silently falls back to the default **asyncify** scheduler,
producing a module that imports 4 asyncify host functions (`start_unwind`,
`stop_unwind`, `start_rewind`, `stop_rewind`) and needs binaryen's
`wasm-opt --asyncify` transform to be instantiable at all.

## The specific trap this caused

`imports_guest.txt` (original) recorded `total=14 asyncify=true` and was filed as
**guest** evidence. It was actually generated from `noct-demo-default.wasm` — the
asyncify default build — not from the `-scheduler=none` guest. Read against
`guest_final.wasm`, it appeared to contradict TOOLCHAIN-LOCK.md's claim of
`total=6 asyncify=false` and made a correct artifact look undeployable.

Timestamps settle it: the pre-pin evidence is 12:37–12:39, the pinned toolchain
archives arrived 13:11–13:15, and `guest_final.wasm` is 13:41.

## Verified replacement

`tools/build-guest.ps1` regenerates the real evidence. Under the pinned pair the
guest links cleanly with `-scheduler=none` and imports **no** asyncify functions:

    wasi_snapshot_preview1: 6 -> fd_write, proc_exit, clock_time_get,
                               args_sizes_get, args_get, random_get
    total=6 asyncify=false

See `artifacts/BUILD-EVIDENCE.md` for hashes and gate results.

## Contents

| File | What it actually is |
|---|---|
| `build_schednone.log` | `-scheduler=none` failure under system Go 1.27.1. Not a property of the guest. |
| `noct-demo-default.wasm` | Default **asyncify** scheduler build (606,280 B, `total=14 asyncify=true`). Kept as a labelled negative control. |
| `tinygo_info.txt` | Reports `scheduler: asyncify` — describes the default build, not the guest. |
| `imports_guest.txt.orig` | The stale guest-evidence file described above. |
| `verify.log`, `verify2.log`, `verify_neg.log`, `v_*.log` | Runs of `verify-guest-wasm.ps1`, which used unpinned `tinygo` from PATH. |
| `schedprobe.wasm` | Probe built by that unpinned path (131,592 B). Superseded by `artifacts/probe_final.wasm`. |
| `test*.log`, `vet*.log`, `b_*.log`, zero-byte logs | Incidental scratch output from the same session. |
