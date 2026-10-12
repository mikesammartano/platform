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
| **Draw** | Pen, Highlighter, Arrow, Circle, Label, Spotlight, Eraser, Clear (tap twice), Undo/Redo, 5 colors, 3 widths |
| **View** | Surface / Combined / Cross-section, plus curated Focus moves: Ocean trench, Subduction zone, Earthquakes, Mantle wedge, Volcanic arc |
| **Teach** | 7-step guided sequence (Start, Plates, Trench, Earthquakes, Magma, Volcanic arc, Complete system) with an "Ask students" prompt for each step |
| **Footer** | Reset returns view, layers, evidence, playback and focus to the starting state. It does **not** erase drawings. Collapse hides the panel. |
| **Playback** | Play/pause, scrubbable progress, ½× / 1× / 2×. No fake elapsed time. The strip fades back after 5 s idle. |
| **Present** | Full screen. Teacher Tools are hidden; labels, legends and a minimal playback line stay. Exit is at the top right, and the model note sits behind the ⓘ button. |

Keyboard shortcuts: `Space` play/pause · `T` tools · `P` present · `L` labels · `←/→` or clicker `PageUp/PageDown` for
Teach steps · `Esc` exits Presentation or Teach · `Ctrl/⌘+Z` undo, `Shift+Ctrl/⌘+Z` redo.

## Scientific model

All of the geometry lives in `src/scene/model.ts`, and `model.test.ts` checks it. The shaders bake in the same
constants (`glsl.ts`), so the picture and the tests cannot drift apart.

- **Idealized Andes-type margin.** The abyssal floor is ~4.4 km deep, with an outer rise and an ~8 km trench. The slab
  dips ~12° at the trench, steepens to 30° and sinks past 300 km. The oceanic lithosphere is 80 km thick, with ~7 km of
  crust. The continental crust thickens to ~62 km under the arc. Convergence is ~7 cm/yr.
- **The ocean surface stays flat over the trench.** The trench exists only in the seafloor and the cross-section.
- **The slab never melts.** Water is released from the slab (blue droplets) and causes partial melting in the mantle
  wedge above it. Separate magma bodies rise, collect in a crustal magma chamber and feed a short conduit to the
  volcano. The mantle is drawn as solid rock.
- **The volcanic arc sits where the slab top is ~118 km deep.** It is ~180 km inland, and a test enforces this.
- **Earthquakes** form a fixed catalog of ~330 events projected onto the section: interface thrusts near the trench,
  intraslab events to ~300 km, a weaker lower plane, outer-rise bending events and shallow crustal events. There are
  none in the hot mantle wedge. Each event flashes on its own cycle while playback runs.
- **Temperature** is a qualitative thermal structure: a cold slab core pushes isotherms down, the mantle wedge is
  hot, and the forearc is cool.
- **Scale.** Deep structure is drawn 1:1. Ocean depth is exaggerated 5×, and land relief about 12× so mountains read
  across a classroom. The on-screen note says so: *Simplified model. Motion is accelerated. Scale and geometry are not
  exact.*

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
  - Pixel ratio is capped at 1.5 and drops automatically if frames are slow.
  - Layers fade with shader uniforms, so no geometry is rebuilt.
  - Float data uses half-float textures, which filter on every WebGL 2 device.
- Accessibility:
  - Tabs and toggles carry ARIA roles and pressed states.
  - Selection is shown by more than color.
  - Keyboard focus is visible.
  - Targets are at least 56 px on a 1080p display.
  - `prefers-reduced-motion` starts the model paused and makes camera moves instant.

## Known limits and next steps

- Drawings sit in screen space. If the teacher changes View or Focus afterwards, the marks stay where they were drawn
  and don't follow the scene.
- The Present button in the closed state isn't in the canonical artboards. Presentation mode needs a way in, and this
  is the least intrusive one.
- The scene is procedural, not photographic. Swapping in authored textures (rock, vegetation, normal maps) is the next
  step toward the fully cinematic look of the reference art.
