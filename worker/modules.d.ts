/**
 * Non-JS modules the Worker imports directly.
 *
 * Wrangler turns these into real module types at build time via the [[rules]]
 * blocks in wrangler.toml: `.wasm` becomes a compiled WebAssembly.Module and
 * `.ttf` becomes an ArrayBuffer of the file's bytes.
 */

declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}

declare module '*.ttf' {
  const data: ArrayBuffer
  export default data
}
