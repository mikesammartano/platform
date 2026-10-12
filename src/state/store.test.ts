import { beforeEach, describe, expect, it } from 'vitest';
import { TEACH_STEPS } from '../content/teach';
import { INITIAL_EVIDENCE, INITIAL_LAYERS, useApp } from './store';
import type { Annotation } from './types';

const initial = useApp.getState();
const mark = (id: number): Annotation => ({ id, kind: 'pen', color: '#F2C94C', width: 7, points: [[0.1, 0.1, 0]] });

describe('app state', () => {
  beforeEach(() => useApp.setState(initial, true));

  it('keeps Show and Evidence earthquakes in sync, and depth implies earthquakes', () => {
    const s = useApp.getState();
    s.toggleEarthquakes();
    expect(useApp.getState().scene.layers.earthquakes).toBe(false);
    useApp.getState().toggleEvidence('earthquakeDepth');
    expect(useApp.getState().scene.layers.earthquakes).toBe(true);
    useApp.getState().toggleEarthquakes();
    expect(useApp.getState().scene.evidence.earthquakeDepth).toBe(false);
  });

  it('reset restores the instructional state but keeps annotations', () => {
    const s = useApp.getState();
    s.commitAnnotations([mark(1)]);
    s.toggleLayer('mantle');
    s.toggleEvidence('temperature');
    s.setFocus('arc');
    s.cycleSpeed();
    useApp.getState().reset();
    const r = useApp.getState();
    expect(r.scene.layers).toEqual(INITIAL_LAYERS);
    expect(r.scene.evidence).toEqual(INITIAL_EVIDENCE);
    expect(r.scene.focus).toBeNull();
    expect(r.scene.view).toBe('combined');
    expect(r.speed).toBe(1);
    expect(r.annotations).toHaveLength(1);
  });

  it('undoes and redoes drawing, including Clear', () => {
    const s = useApp.getState();
    s.commitAnnotations([mark(1)]);
    useApp.getState().commitAnnotations([mark(1), mark(2)]);
    useApp.getState().clearAnnotations();
    expect(useApp.getState().annotations).toHaveLength(0);
    useApp.getState().undo();
    expect(useApp.getState().annotations).toHaveLength(2);
    useApp.getState().undo();
    expect(useApp.getState().annotations).toHaveLength(1);
    useApp.getState().redo();
    expect(useApp.getState().annotations).toHaveLength(2);
  });

  it('walks the seven Teach steps and applies each scene', () => {
    useApp.getState().startTeach();
    expect(useApp.getState().teach).toEqual({ active: true, step: 0 });
    expect(useApp.getState().scene.view).toBe('surface');
    for (let i = 1; i < TEACH_STEPS.length; i++) {
      useApp.getState().teachGo(i);
      expect(useApp.getState().scene.labelSet).toEqual(TEACH_STEPS[i].labels);
    }
    useApp.getState().teachGo(99);
    expect(useApp.getState().teach.step).toBe(TEACH_STEPS.length - 1);
    expect(useApp.getState().scene.layers.earthquakes).toBe(true);
    useApp.getState().exitTeach();
    expect(useApp.getState().teach.active).toBe(false);
  });

  it('teach prompts follow the writing rules (short, no em dashes)', () => {
    expect(TEACH_STEPS).toHaveLength(7);
    for (const s of TEACH_STEPS) {
      for (const text of [s.title, s.note, s.ask]) expect(text).not.toMatch(/—/);
      expect(s.note.split(/\s+/).length).toBeLessThan(20);
    }
  });
});
