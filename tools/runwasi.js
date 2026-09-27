// runwasi.js executes a WASI preview1 module and forwards its stdout.
//
// It exists so the TinyGo-compiled noctmath probe can be run on this machine
// without installing a standalone wasm runtime. Verification that a kernel
// merely compiles is weak evidence: TinyGo can compile code that then traps at
// runtime, and the whole point of the checked arithmetic is that overflow and
// division by zero surface as returned errors rather than as a wasm trap. So the
// probe is actually executed and its output diffed against the native run.
const fs = require('node:fs');
const { WASI } = require('node:wasi');

const target = process.argv[2];
if (!target) {
  console.error('usage: node runwasi.js <module.wasm>');
  process.exit(2);
}

const wasi = new WASI({
  version: 'preview1',
  args: process.argv.slice(2),
  env: process.env,
  returnOnExit: true,
});

const bytes = fs.readFileSync(target);
const mod = new WebAssembly.Module(bytes);
const inst = new WebAssembly.Instance(mod, wasi.getImportObject());

const code = wasi.start(inst);
if (code !== 0) {
  console.error(`wasi exit code ${code}`);
}
process.exit(code === null ? 0 : code);
