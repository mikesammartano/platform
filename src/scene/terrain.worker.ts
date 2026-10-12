import { computeTerrain } from './terrain';

/** Builds the landscape off the main thread so the page stays responsive while it loads. */
self.onmessage = (e: MessageEvent<{ x: number; y: number; z: number }>) => {
  const d = computeTerrain(e.data);
  (self as unknown as Worker).postMessage(d, [d.pos.buffer, d.light.buffer, d.index.buffer, d.profile.buffer, d.heights.buffer]);
};
