import { type Page, expect, test } from '@playwright/test';

/* Every teacher-facing control is exercised here against the real app (dev build exposes __app/__engine). */

type AppState = {
  scene: {
    layers: Record<string, boolean>;
    evidence: Record<string, boolean>;
    view: string;
    focus: string | null;
  };
  panelOpen: boolean;
  presenting: boolean;
  playing: boolean;
  speed: number;
  teach: { active: boolean; step: number };
  annotations: { kind: string; text?: string; points: number[][] }[];
  draw: { tool: string; color: string; width: number };
};

const state = (page: Page) => page.evaluate(() => (window as unknown as { __app: { getState: () => AppState } }).__app.getState());
const S = (page: Page) => state(page);
const btn = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const progress = (page: Page) => page.evaluate(() => (window as unknown as { __engine: { progress: number } }).__engine.progress);
const camera = (page: Page) =>
  page.evaluate(() => {
    const e = (window as unknown as { __engine: { project: (p: number[]) => number[] | null } }).__engine;
    return e.project([0, -39, 0.5]);
  });

async function open(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => 'webglFallback' in window || '__engine' in window);
  await btn(page, 'Open Teacher Tools').click();
  await expect(page.getByRole('complementary', { name: 'Teacher Tools' })).toHaveAttribute('data-open', '1');
}

async function drag(page: Page, pts: [number, number][]) {
  await page.mouse.move(...pts[0]);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 5 });
  await page.mouse.up();
}

test('Show toggles every layer, including Geology', async ({ page }) => {
  await open(page);
  const rows: [string, string][] = [
    ['Surface', 'surface'], ['Plates', 'plates'], ['Mantle', 'mantle'], ['Plate motion', 'plateMotion'],
    ['Earthquakes', 'earthquakes'], ['Magma', 'magma'], ['Volcanoes', 'volcanoes'], ['Labels', 'labels'], ['Motion arrows', 'motionArrows'],
  ];
  for (const [name, key] of rows) {
    const before = (await S(page)).scene.layers[key];
    await btn(page, name).click();
    expect((await S(page)).scene.layers[key]).toBe(!before);
    await expect(btn(page, name)).toHaveAttribute('aria-pressed', String(!before));
  }
  await btn(page, 'Geology').click();
  for (const [name, key] of [['Crust', 'crust'], ['Lithosphere', 'lithosphere'], ['Asthenosphere', 'asthenosphere']] as const) {
    await btn(page, name).click();
    expect((await S(page)).scene.layers[key]).toBe(true);
  }
});

test('Labels show on the scene and hide with the Labels control', async ({ page }) => {
  await open(page);
  await expect(page.locator('.label[data-visible="1"]').first()).toBeAttached();
  await btn(page, 'Labels').click();
  await expect(page.locator('.label[data-visible="1"]')).toHaveCount(0);
});

test('Evidence rows switch data on and show legends', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Evidence' }).click();
  await btn(page, 'Earthquake depth').click();
  await expect(page.locator('.legend', { hasText: 'Earthquake depth' })).toBeVisible();
  for (const [name, legend] of [['Plate motion', 'Plate motion'], ['Bathymetry', 'Ocean depth'], ['Topography', 'Elevation'], ['Temperature', 'Temperature']]) {
    await btn(page, name).click();
    await expect(page.locator('.legend', { hasText: legend })).toBeVisible();
  }
  const ev = (await S(page)).scene.evidence;
  expect(ev).toMatchObject({ earthquakeDepth: true, gps: true, bathymetry: true, topography: true, temperature: true });
  // Earthquakes is shared with Show, and turning it off removes the depth legend
  await btn(page, 'Earthquakes').click();
  expect((await S(page)).scene.layers.earthquakes).toBe(false);
  await expect(page.locator('.legend', { hasText: 'Earthquake depth' })).toHaveCount(0);
});

test('Draw: every mark type, eraser, undo, redo and two-tap clear', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Draw' }).click();
  await drag(page, [[500, 700], [600, 650], [700, 720]]);
  await btn(page, 'Highlighter').click();
  await drag(page, [[400, 800], [700, 820]]);
  await btn(page, 'Arrow').click();
  await btn(page, 'Red').click();
  await drag(page, [[300, 500], [520, 640]]);
  await btn(page, 'Circle').click();
  await btn(page, 'Thick').click();
  await drag(page, [[800, 700], [1000, 820]]);
  await btn(page, 'Label').click();
  await page.mouse.click(900, 560);
  await page.getByLabel('Label text').fill('Trench');
  await page.keyboard.press('Enter');
  let st = await S(page);
  expect(st.annotations.map((a) => a.kind)).toEqual(['pen', 'highlighter', 'arrow', 'circle', 'label']);
  expect(st.annotations[3]).toMatchObject({ color: '#E5484D', width: 12 });
  expect(st.annotations[4].text).toBe('Trench');
  // every point is anchored in the world (x, y, z)
  expect(st.annotations.every((a) => a.points.every((p) => p.length === 3))).toBe(true);

  await btn(page, 'Eraser').click();
  await drag(page, [[590, 650], [610, 660]]);
  expect((await S(page)).annotations).toHaveLength(4);

  await btn(page, 'Undo').click();
  expect((await S(page)).annotations).toHaveLength(5);
  await btn(page, 'Redo').click();
  expect((await S(page)).annotations).toHaveLength(4);

  await btn(page, 'Clear all drawings').click();
  expect((await S(page)).annotations).toHaveLength(4);
  await btn(page, 'Tap again to clear all drawings').click();
  st = await S(page);
  expect(st.annotations).toHaveLength(0);
  await btn(page, 'Undo').click();
  expect((await S(page)).annotations).toHaveLength(4);
});

test('Drawings stay attached to the scene when the camera moves', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Draw' }).click();
  await btn(page, 'Arrow').click();
  await drag(page, [[600, 760], [760, 700]]);
  const tip = (await S(page)).annotations[0].points[1];
  const before = await page.evaluate((p) => (window as unknown as { __engine: { project: (p: number[]) => number[] } }).__engine.project(p), tip);
  await page.getByRole('tab', { name: 'View' }).click();
  await btn(page, 'Subduction zone').click();
  await expect
    .poll(async () => {
      const after = await page.evaluate((p) => (window as unknown as { __engine: { project: (p: number[]) => number[] } }).__engine.project(p), tip);
      return Math.hypot(after[0] - before[0], after[1] - before[1]);
    }, { timeout: 40_000 })
    .toBeGreaterThan(20);
});

test('Spotlight dims the scene and hides color and width', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Draw' }).click();
  await btn(page, 'Spotlight').click();
  await expect(page.locator('.spot')).toBeVisible();
  await expect(page.locator('.dimmable').first()).toHaveAttribute('data-dim', '1');
  await page.mouse.move(700, 600);
  await expect(page.locator('.spot')).toHaveAttribute('style', /700px 600px/);
  await page.getByRole('tab', { name: 'Show' }).click();
  await expect(page.locator('.spot')).toHaveCount(0);
});

test('View and Focus move the camera to curated states', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'View' }).click();
  const c0 = await camera(page);
  for (const v of ['Surface', 'Cross-section', 'Combined']) {
    await btn(page, v).click();
    expect((await S(page)).scene.view).toBe(v === 'Cross-section' ? 'section' : v.toLowerCase());
  }
  for (const [name, key] of [['Ocean trench', 'trench'], ['Subduction zone', 'subduction'], ['Earthquakes', 'earthquakes'], ['Mantle wedge', 'wedge'], ['Volcanic arc', 'arc']]) {
    await btn(page, name).click();
    expect((await S(page)).scene.focus).toBe(key);
  }
  await expect.poll(async () => JSON.stringify(await camera(page)), { timeout: 40_000 }).not.toBe(JSON.stringify(c0));
  await btn(page, 'Volcanic arc').click();
  expect((await S(page)).scene.focus).toBeNull();
});

test('Teach walks seven steps; Exit and Finish leave Teach', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /^Teach/ }).click();
  await expect(page.getByText('1 of 7')).toBeVisible();
  await expect(btn(page, 'Previous')).toBeDisabled();
  for (let i = 2; i <= 7; i++) {
    await btn(page, 'Next').click();
    await expect(page.getByText(`${i} of 7`)).toBeVisible();
  }
  await expect(btn(page, 'Finish')).toBeVisible();
  await btn(page, 'Previous').click();
  await expect(page.getByText('6 of 7')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('7 of 7')).toBeVisible();
  await btn(page, 'Finish').click();
  expect((await S(page)).teach.active).toBe(false);
  await page.getByRole('button', { name: /^Teach/ }).click();
  await btn(page, 'Exit teaching').click();
  expect((await S(page)).teach.active).toBe(false);
});

test('Playback: pause, speed and scrubbing', async ({ page }) => {
  await open(page);
  await btn(page, 'Pause').click();
  expect((await S(page)).playing).toBe(false);
  const p0 = await progress(page);
  await page.waitForTimeout(800);
  expect(await progress(page)).toBe(p0);
  await page.getByRole('button', { name: /Change speed/ }).click();
  expect((await S(page)).speed).toBe(2);
  const track = page.getByRole('slider', { name: 'Animation progress' });
  const box = (await track.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  expect(await progress(page)).toBeGreaterThan(0.7);
  await btn(page, 'Play').click();
  expect((await S(page)).playing).toBe(true);
});

test('Reset restores the scene but keeps drawings; Collapse and Tools', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Draw' }).click();
  await drag(page, [[500, 700], [650, 690]]);
  await page.getByRole('tab', { name: 'Show' }).click();
  await btn(page, 'Mantle').click();
  await btn(page, 'Reset visualization').click();
  const st = await S(page);
  expect(st.scene.layers.mantle).toBe(false);
  expect(st.annotations).toHaveLength(1);
  await btn(page, 'Collapse Teacher Tools').click();
  await expect(btn(page, 'Open Teacher Tools')).toBeVisible();
  await page.keyboard.press('t');
  expect((await S(page)).panelOpen).toBe(true);
});

test('Presentation mode: tools hidden, Tools button opens them, Esc backs out', async ({ page }) => {
  await open(page);
  await btn(page, 'Collapse Teacher Tools').click();
  await btn(page, 'Present full screen').click();
  expect((await S(page)).presenting).toBe(true);
  const panel = page.getByRole('complementary', { name: 'Teacher Tools', includeHidden: true });
  await expect(panel).toHaveAttribute('data-open', '0');
  await btn(page, 'Model note').click();
  await expect(page.getByRole('note')).toContainText('Simplified model');
  // Tools are one tap away while presenting
  await btn(page, 'Open Teacher Tools').click();
  await expect(panel).toHaveAttribute('data-open', '1');
  expect((await S(page)).presenting).toBe(true);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveAttribute('data-open', '0');
  expect((await S(page)).presenting).toBe(true);
  await btn(page, 'Exit presentation').click();
  expect((await S(page)).presenting).toBe(false);
});
