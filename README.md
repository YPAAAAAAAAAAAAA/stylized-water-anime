# Water — Anime Style

Full-bleed auto-play of the anime water floor from [cortiz2894/stylized-components](https://github.com/cortiz2894/stylized-components) (`/water`).

Cel-shaded Voronoi water (F1 − Smooth F1), a slower seabed, four-point sparkles, impact ripples, and a GPU ping-pong wave simulation around the dragon-ball cluster. A glass feather drifts on the surface. The scene starts on its own. There is no menu, nav, or debug panel.

## Credit

Upstream: **cortiz2894/stylized-components** by Christian Ortiz (Cortiz).  
License: MIT. The copyright notice and permission text are in `LICENSE`.  
This house vendors the `/water` effect (page `src/app/water/`, component tree `src/components/waterFloor/`) and the two models that scene loads: `dragon-balls-model.glb` and `feather.glb`.

## Play

`play.html` is a static WebGL2 page. It fills the GitBrew phone island (width × 1.2, max-height 120vw). Drag orbits. A two-finger pinch dollies. The first painted frame is already the running water.

## iPhone / WebGL

- WebGL2 only. There is no WebGPU path and no second renderer.
- If the model images fail to decode, those surfaces are 1×1 black. Nothing is inserted into the page as a broken image, so no “?” glyph appears.
- Wave height uses RGBA16F when the device can render to it, and RGBA8 otherwise. The cel water still draws.
- Touch only: drag and pinch. No pointer lock, keyboard, or file picker.
- The color buffer is drawn at about a fifth of the CSS size and frames are paced, so the cel shader stays inside a phone's frame budget. The scene is the same picture, a little softer.
