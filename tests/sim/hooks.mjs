// Redirects the game's `three` import to a shim (real three.js from npm, but with a fake WebGL renderer) and the GLTF loader to a stub.
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: new URL('./three-shim.mjs', import.meta.url).href, shortCircuit: true };
  if (spec.endsWith('assets/three/GLTFLoader.js')) return { url: new URL('./gltf-stub.mjs', import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}
