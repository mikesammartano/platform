import * as THREE from 'three';

/**
 * Small CC0 detail textures in public/textures (see README credits). They load after the scene is up;
 * shaders read a flat value until then, so nothing waits on them.
 */
const loader = new THREE.TextureLoader();
const listeners = new Set<() => void>();
const cache = new Map<string, THREE.Texture>();

/** Called whenever a detail texture finishes loading (the engine redraws when paused). */
export function onDetailLoad(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tiling data texture (normal map or mask), linear values, repeat wrap, mipmapped. */
export function detailTex(file: string, opts: { color?: boolean; repeat?: boolean } = {}) {
  const key = file;
  const hit = cache.get(key);
  if (hit) return hit;
  const t = loader.load(`${import.meta.env.BASE_URL}textures/${file}`, () => listeners.forEach((fn) => fn()));
  t.colorSpace = opts.color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (opts.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 8;
  cache.set(key, t);
  return t;
}
