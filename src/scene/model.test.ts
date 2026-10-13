import { describe, expect, it } from 'vitest';
import {
  ARC_X, CHAMBER, COAST_X, LASCAR_X, MELT, SLAB, SLAB_ARC_LEN, buildQuakeCatalog, labY, mohoY,
  seafloorAnalytic, slabCoords, slabPoint, slabTopY,
} from './model';

describe('subduction geometry', () => {
  it('places the trench at x = 0 as the deepest point of the ocean floor', () => {
    expect(seafloorAnalytic(0)).toBeCloseTo(SLAB.trenchY, 1);
    for (let x = -800; x < 0; x += 10) expect(seafloorAnalytic(x)).toBeGreaterThan(SLAB.trenchY);
  });

  it('round-trips slab coordinates', () => {
    for (const s of [-300, -20, 10, 80, SLAB_ARC_LEN - 1, SLAB_ARC_LEN + 50, 350]) {
      for (const n of [0, 9, 40, 79]) {
        const p = slabPoint(s, n);
        const c = slabCoords(p.x, p.y);
        expect(c.s).toBeCloseTo(s, 3);
        expect(c.n).toBeCloseTo(n, 3);
      }
    }
  });

  it('steepens with depth: ~6 deg at the trench and ~30 deg at depth (Nazca slab, Slab2)', () => {
    const dip = (x: number) => (Math.atan(slabTopY(x) - slabTopY(x + 1)) * 180) / Math.PI;
    expect(dip(1)).toBeGreaterThan(5);
    expect(dip(1)).toBeLessThan(9);
    expect(dip(700)).toBeCloseTo(30, 0);
  });

  it('puts the volcanic arc at Lascar, where the slab is ~120-140 km deep', () => {
    expect(ARC_X).toBeGreaterThan(COAST_X + 50);
    expect(Math.abs(ARC_X - LASCAR_X)).toBeLessThan(10);
    expect(slabTopY(LASCAR_X)).toBeLessThan(-120);
    expect(slabTopY(LASCAR_X)).toBeGreaterThan(-140);
  });

  it('generates magma in the mantle wedge above the slab, not inside it', () => {
    const c = slabCoords(MELT.x, MELT.y);
    expect(c.n).toBeLessThan(-10);
    expect(MELT.y).toBeLessThan(labY(MELT.x));
    expect(CHAMBER.y).toBeGreaterThan(mohoY(CHAMBER.x));
    expect(Math.abs(CHAMBER.x - ARC_X)).toBeLessThan(10);
  });

  it('keeps continental layers ordered: Moho above the lithosphere base', () => {
    for (let x = COAST_X; x < 1200; x += 20) {
      expect(mohoY(x)).toBeGreaterThan(labY(x));
      expect(mohoY(x)).toBeLessThan(-30);
    }
  });
});

describe('earthquake catalog', () => {
  const quakes = buildQuakeCatalog();

  it('is deterministic', () => {
    expect(buildQuakeCatalog()).toEqual(quakes);
  });

  it('has no earthquakes in the hot mantle wedge or deep mantle', () => {
    for (const q of quakes) {
      if (q.kind === 'crustal') continue;
      const { n } = slabCoords(q.x, q.y);
      expect(n).toBeGreaterThan(-3);
      expect(n).toBeLessThan(SLAB.H);
    }
  });

  it('deepens away from the trench (Wadati-Benioff zone)', () => {
    const slab = quakes.filter((q) => q.kind === 'intraslab' || q.kind === 'interface');
    const near = slab.filter((q) => q.x < 100);
    const far = slab.filter((q) => q.x > 300);
    const mean = (a: typeof slab) => a.reduce((t, q) => t + q.depthKm, 0) / a.length;
    expect(mean(far)).toBeGreaterThan(mean(near) + 100);
    expect(Math.max(...slab.map((q) => q.depthKm))).toBeGreaterThan(250);
  });
});
