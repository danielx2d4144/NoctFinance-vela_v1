// listimports.js dumps the import section of a wasm module.
//
// Used to establish whether a TinyGo wasm artifact depends on the asyncify
// host functions. TinyGo's default wasm scheduler is asyncify-based, and asyncify
// only works if binaryen's `wasm-opt --asyncify` transform has been applied to the
// module. A verification-only wasm-opt stub copies the module through untouched,
// so a module that still imports asyncify cannot be instantiated by a host that
// does not implement it -- which is exactly how a "successful" build can produce
// an artifact that will not run.
const fs = require('node:fs');

const target = process.argv[2];
if (!target) {
  console.error('usage: node listimports.js <module.wasm>');
  process.exit(2);
}

const mod = new WebAssembly.Module(fs.readFileSync(target));
const imports = WebAssembly.Module.imports(mod);

const byModule = new Map();
for (const imp of imports) {
  if (!byModule.has(imp.module)) byModule.set(imp.module, []);
  byModule.get(imp.module).push(imp.name);
}

let asyncify = false;
for (const [name, fns] of byModule) {
  console.log(`${name}: ${fns.length} import(s) -> ${fns.join(', ')}`);
  if (name === 'asyncify') asyncify = true;
}

console.log(`total=${imports.length} asyncify=${asyncify}`);
process.exit(asyncify ? 10 : 0);
