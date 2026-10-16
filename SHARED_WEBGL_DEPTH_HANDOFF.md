# Spatial Draw shared-depth handoff

Publication date: 2026-10-15. Branch: `feature/shared-webgl-depth`.

This branch changes only Spatial Draw's renderer setup and line materials. It must be used with
the matching UI and Edge Server branches. The complete cross-repository handoff is
[in toolbox-userinterface](https://github.com/dataTimeSpace/toolbox-userinterface/blob/feature/shared-webgl-depth/SHARED_WEBGL_DEPTH_HANDOFF.md).

## Base and dependencies

- Base commit: `9fc33f9200f3c8d2acf2176b1d8765fcbbb32dcd` (2026-08-12). The branch was created
  from the checked-out Core submodule on 2026-09-02; that commit was also local `main`.
- UI: `dataTimeSpace/toolbox-userinterface`, `feature/shared-webgl-depth`.
- Edge: `dataTimeSpace/edge-server`, `feature/shared-webgl-depth`. Edge pins this branch's
  implementation commit in its `addons/vuforia-spatial-core-addon` submodule.
- Core's remote `main` was two commits ahead of this base at the publication check. This branch
  preserves its original base; it has not been rebased onto current `main`.

## Changes

- `tools/spatialDraw/index.js` consumes the compositor's CSS dimensions and physical pixel ratio
  at bootstrap and resize, applies them to both Three.js renderers, and refreshes projection data.
- Immediately before rendering, it emits `enable(DEPTH_TEST)`, `depthFunc(LEQUAL)`, and
  `depthMask(true)`. Three.js's private state cache otherwise may omit those calls after another
  renderer has reset the shared GL context.
- `tools/spatialDraw/DrawingManager.js` explicitly enables depth testing and writing on generated
  MeshLine materials. Existing live and deserialized lines use that material factory.
- No Sphere, Motion, Popup addon, iOS, or other tool implementation was changed here.

## Activate and diagnose

In the top-level UI page's console, on the exact origin being tested:

```js
localStorage.setItem('realityEditor.glProxyRendererMode', 'shared');
location.reload();
```

`legacy` selects the separate tool canvas and cannot share depth with the host scene. The flag is
per origin; a change of hostname, IP, port, or browser profile needs its own setting. Reload/reopen
the tool iframe after replacing the worker or tool assets.

The new UI's `realityEditor.gui.glRenderer.getDiagnostics()` should show shared mode, host context
identity, protocol 2, matching physical viewport dimensions, depth enabled, and no GL error. A
missing method usually means the wrong/stale UI was served. Viewport and depth details are absent
from the older splat integration snapshot; see the full handoff.

## Verification and unfinished work

- On 2026-10-15, the Edge tests `tests/gl-worker-protocol.test.js` and
  `tests/spatial-draw-viewport.test.js` passed (10 tests total). The latter checks Spatial Draw
  startup/resize with a stub renderer and checks for its explicit depth contract in source; it is
  not a real GPU test of the complete tool.
- Lint on the two changed JS files passed with the existing unused `eventData` warning.
- Full Core lint fails on the unchanged `interfaces/kepware/index.js:13` top-level return. The
  same error was verified against this branch's base version. Unrelated webPost indentation
  warnings also remain. These were not fixed as part of publishing this feature.
- Full browser integration, Safari/mobile GPUs, real tool context restoration, scene switching,
  multiple simultaneous tools, transparent geometry, and long-session resource use need testing.
- Sphere still needs custom viewport/resize modernization; Motion uses its own visible iframe
  canvas and needs migration before it can share host depth.
- Spatial Draw uses custom legacy bootstrap hooks and has no matching custom dispose hook.
  Rebootstrap/context migration must be tested with the real tool before calling it complete.

Continue on a new branch from this implementation, coordinate UI/worker/tool versions, and keep
shared mode opt-in until the real browser and tool matrix in the cross-repository handoff passes.
