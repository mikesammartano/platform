import { computeTerrain } from './terrain';

/** Decodes the elevation data and builds the landscape off the main thread so the page stays responsive. */
self.onmessage = async (e: MessageEvent<{ x: number; y: number; z: number }>) => {
  const d = await computeTerrain(e.data);
  (self as unknown as Worker).postMessage(d, [
    d.pos.buffer, d.index.buffer, d.profile.buffer, d.midY.buffer, d.nearY.buffer, d.farY.buffer,
    d.midNL.buffer, d.nearNL.buffer, d.farNL.buffer,
  ]);
};
