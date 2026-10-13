# Subduction Zone: classroom visualization

An interactive, full-screen 3D model of an ocean plate sinking beneath a continent (oceanic-continental subduction),
with a slide-in **Teacher Tools** panel. It is built for a teacher at a large interactive display, for grades 6 to 12
(grade 8 reading level).

Built from the Claude Design handoff in [`design/`](design/). The canonical artboards are `01`–`07` in
`design/project/Classroom Visualization.dc.html`, which render `ToolsScene6.dc.html`.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # geometry, earthquake catalog and app-state tests
npm run e2e        # Playwright: every teacher tool, end to end (needs a Chromium; WebGL via SwiftShader)
npm run build      # static site in dist/ (relative paths, host anywhere)
```

`dist/` is a plain static site with no server or backend. It works on Netlify, Vercel, Cloudflare Pages, GitHub Pages
or a district web server. It needs WebGL 2, which current Chrome, Edge, Safari and Firefox all support, Chromebooks
included.

## What teachers get

| Area | Controls |
| --- | --- |
| **Show** | Surface, Plates, Mantle · Plate motion, Earthquakes, Magma, Volcanoes · Labels, Motion arrows · Geology ▸ Crust, Lithosphere, Asthenosphere |
| **Evidence** | Earthquakes, Earthquake depth (floating legend), Plate motion (velocity arrows, ~7 cm/yr), Bathymetry, Topography, Temperature |
| **Draw** | Pen, Highlighter, Arrow, Circle, Label, Spotlight, Eraser, Clear (tap twice), Undo/Redo, 5 colors, 3 widths. Marks are pinned to the scene and follow every camera move. |
| **View** | Surface / Combined / Cross-section, plus curated Focus moves: Ocean trench, Subduction zone, Earthquakes, Mantle wedge, Volcanic arc |
| **Teach** | 7-step guided sequence (Start, Plates, Trench, Earthquakes, Magma, Volcanic arc, Complete system) with an "Ask students" prompt for each step |
| **Footer** | Reset returns view, layers, evidence, playback and focus to the starting state. It does **not** erase drawings. Collapse hides the panel. |
| **Playback** | Play/pause, scrubbable progress, ½× / 1× / 2×. No fake elapsed time. The strip fades back after 5 s idle. |
| **Present** | Full screen. Teacher Tools are hidden; labels, legends and a minimal playback line stay. Tools and Exit stay as icon buttons at the top right. |

Keyboard shortcuts: `Space` play/pause · `T` tools · `P` present · `L` labels · `←/→` or clicker `PageUp/PageDown` for
Teach steps · `Esc` exits Presentation or Teach · `Ctrl/⌘+Z` undo, `Shift+Ctrl/⌘+Z` redo.

## Scientific model

All of the geometry lives in `src/scene/model.ts`, and `model.test.ts` checks it. The shaders bake in the same
constants (`glsl.ts`), so the picture and the tests cannot drift apart.

- **The central Andes at 23.4° S.** The Nazca plate meets South America at the Atacama trench (~8 km deep, 71.35° W).
  The abyssal floor is ~4.4 km deep, with an outer rise. Following Slab2, the slab dips ~6° at the trench, stays
  shallow under the forearc, steepens to 30° and sinks past 300 km. The oceanic lithosphere is 80 km thick, with ~7 km of
  crust. The continental crust thickens to ~62 km under the arc. Convergence is ~7 cm/yr.
- **The ocean surface stays flat over the trench.** The trench exists only in the seafloor and the cross-section.
- **The slab never melts.** Water is released from the slab (blue droplets) and causes partial melting in the mantle
  wedge above it. Separate magma bodies rise, collect in a crustal magma chamber and feed a short conduit to the
  volcano. The mantle is drawn as solid rock.
- **The volcanic arc sits where the slab top is ~130 km deep.** That is under Láscar, ~370 km from the trench, and a
  test enforces this. The section cuts through the real surface profile: coastal cliffs, the Coastal Cordillera,
  the Central Depression, the Domeyko range, Salar de Atacama, the arc, the Puna plateau and the Chaco plains.
- **Earthquakes** form a fixed catalog of ~330 events projected onto the section: interface thrusts near the trench,
  intraslab events to ~300 km, a weaker lower plane, outer-rise bending events and shallow crustal events. There are
  none in the hot mantle wedge. Each event flashes on its own cycle while playback runs.
- **One playback loop is one earthquake cycle.** The shallow plate interface is locked and glows amber as strain
  builds, while the forearc is slowly dragged down. At about 3/4 of the loop the locked patch slips: the rupture runs
  along the fault, P and S waves spread through the rock, the forearc springs back up (elastic rebound), and a
  trench-parallel tsunami runs out to sea and toward the coast. A burst of aftershocks follows. Teach step 4 jumps to
  just before the rupture.
- **Plates visibly move.** Evenly spaced age bands ride on the oceanic plate and carry it down into the mantle.
  Sediment scraped off the plate builds an accretionary wedge at the trench.
- **Magma comes in batches.** Each batch rises through the wedge and lithosphere to the crustal chamber. The chamber,
  conduit, crater glow, flank lava and plume all pulse when a batch arrives.
- **Mantle** (Show ▸ Mantle) adds slow flow trails: corner flow in the wedge, dragged down beside the slab.
- **Temperature** is a qualitative thermal structure: a cold slab core pushes isotherms down, the mantle wedge is
  hot, and the forearc is cool.
- **Scale.** Deep structure is drawn 1:1. Ocean depth is exaggerated 5×, and land relief 7× so mountains read
  across a classroom.

## Rendering

The landscape is real: the central Andes north of a cut at 23.4° S, through Láscar volcano. The rest is procedural,
apart from two small files for the sea in `public/textures/`.

- **Lighting:** linear HDR with ACES filmic tone mapping. A warm sun and sky light the scene, and bloom picks up only
  the brightest light (lava, the sun and its glint). A light vignette and film grain finish each frame.
- **Terrain:** real elevation and bathymetry (Terrarium tiles) and real colour (Sentinel-2 cloudless mosaic, dry
  season 2020), in `public/geo/`: a detailed grid over the margin (1,750 km square) and a coarse one out to the
  Caribbean. The Atacama coast and trench, Salar de Atacama, the Altiplano-Puna, Titicaca, Uyuni and the Amazon
  are all where they really are. The satellite shading is removed (de-shaded with the elevation and the satellite's
  sun angle), so the scene's own sun lights the relief. Normals, sun shadows and ambient occlusion are baked from
  the elevation in a worker at load, and close-up views add fine detail normals.
  `scripts/geodata/build.py` rebuilds the assets (Python with rasterio, numpy and pillow).
- **Sky and sea:** one atmosphere model drives the sky and the haze over distant land and sea, so far mountains
  fade into the sky behind them. Clouds are lit with self-shadowing. The ocean has swell trains, Fresnel reflection,
  a sun glint path, light through the wave crests, and surf and whitecaps.
- **Eruption:** the column is lit, billowing ash, glowing at the vent and pulsing with each magma batch.
- **Cross-section:** the cut rock has lit relief. Melt, the magma conduit, the rupture and earthquake flashes glow.

## Architecture

```
src/
  scene/        Three.js (no React): Engine (render loop, fades, camera moves, label projection),
                model (science), terrain, section (cut-face shader), environment (sky/ocean),
                effects (quakes, magma, water, mantle flow, plume, arrows), cameras, labels
  state/        zustand store: scene state, Teach, playback, drawing history
  content/      Teach sequence text
  ui/           React UI: Panel (tabs, footer, Teach), Overlay (playback, legends, present),
                Labels (DOM labels positioned by the engine), Ink (drawing + spotlight)
```

- One continuous full-viewport WebGL canvas sits under everything, as `design/project/CLAUDE.md` requires. The panel
  is a translucent, blurred overlay. When the panel is open, the camera's view offset shifts so the science stays
  centered in the uncovered area.
- The UI is laid out at the 1920×1080 design size and scaled to the display, down to a 1366×768 Chromebook.
- Performance:
  - Frames render only while something moves.
  - A pixel budget (about 1080p × 1.4) sets the render resolution, so 4K boards and Chromebooks keep their frame
    rate. Resolution drops further automatically if frames are slow.
  - If the GPU context is lost (the board sleeps, or the driver resets), the page recovers by reloading.
  - Layers fade with shader uniforms, so no geometry is rebuilt.
  - Float data uses half-float textures, which filter on every WebGL 2 device.
- Accessibility:
  - Tabs and toggles carry ARIA roles and pressed states.
  - Selection is shown by more than color.
  - Keyboard focus is visible.
  - Targets are at least 56 px on a 1080p display.
  - `prefers-reduced-motion` starts the model paused and makes camera moves instant.

## Known limits and next steps

- The Present button in the closed state isn't in the canonical artboards. Presentation mode needs a way in, and this
  is the least intrusive one.
- The scene is procedural, not photographic. Swapping in authored textures (rock, vegetation, normal maps) is the next
  step toward the fully cinematic look of the reference art.

## Credits

- `public/textures/sky_blouberg_sunrise_2_1k.hdr`: "Blouberg Sunrise 2" by Greg Zaal, [Poly Haven](https://polyhaven.com/a/blouberg_sunrise_2), CC0.
  Used for the clouds seen in ocean reflections, rotated to match the scene's sun.
- `public/textures/waternormals.jpg`: wave normal map from the [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/textures).
- `public/geo/*_color.webp`: contains modified Copernicus Sentinel data 2020 processed by Sentinel Hub
  ([Sentinel-2 L2A 120 m mosaic](https://registry.opendata.aws/sentinel-s2-l2a-mosaic-120/)), CC BY 4.0.
- `public/geo/*_dem.webp`: [Terrarium elevation tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen; SRTM,
  GMTED2010, ETOPO1 and other public sources).
