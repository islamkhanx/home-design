# AGENTS.md — Parametric 3D Apartment Visualizer

## Mission

Build a lightweight, code-first, parametric apartment design application with accurate geometry, reusable furniture components and two rendering modes. The apartment must have one canonical data model shared by all views and rendering engines.

## Mandatory technology stack

Application and real-time renderer:

- Vue 3, Vite, TypeScript.
- Three.js + TresJS; `@tresjs/cientos` for scene helpers and camera controls.
- Three.js `GLTFExporter` for transferring geometry to Blender.

High-quality offline renderer:

- Blender with Cycles.
- Python `bpy` for automated scene import, configuration and rendering.
- Blender CLI for headless rendering.

Geometry and application data:

- TypeScript schemas and parametric geometry functions.
- JSON apartment definitions.
- Millimeter precision in source data; Three.js world units in meters.

No backend or cloud rendering service is required.

## Rendering mode 1 — FAST

Three.js / TresJS is the default interactive workflow. Implement instant geometry updates, orthographic dollhouse, top-down floor-plan and perspective interior cameras, PBR materials, ambient/environment lighting, soft shadows and tone mapping, orbit/zoom/pan, interactive selection and PNG screenshot export.

Optimize for ordinary laptop hardware. Visual quality must support evaluating layouts, finishes and lighting arrangements. Do not sacrifice dimensional correctness for presentation.

## Rendering mode 2 — PERFECT

Blender Cycles renders the exact same apartment geometry:

1. Export geometry using `GLTFExporter`.
2. Save scene metadata, camera presets and material definitions alongside GLB.
3. Import GLB through a Python script.
4. Reconstruct or improve materials, lighting and camera settings.
5. Render using Cycles with adaptive sampling and denoising.
6. Save PNG output.

Use physically based lighting, appropriate textures, reflections, global illumination, soft shadows and high-quality settings. Presets:

- `preview`: 960×540, low samples.
- `quality`: 1920×1080, adaptive sampling.
- `ultra`: 3840×2160, higher samples and denoising.

These are quality presets, not guaranteed rendering times. Support headless final renders with `npm run dev`, `npm run export:scene`, `npm run render:quality`, `npm run render:ultra`. Use the installed Blender executable, configurable paths, and CPU/GPU Cycles where available.

## Shared scene architecture

Apartment JSON / TypeScript → parametric geometry → canonical 3D scene → FAST Three.js or GLB export → Blender Cycles PERFECT.

Both engines must have identical architectural geometry, dimensions and placement. Lighting fidelity, materials and image quality may differ. Never remodel architecture in Blender.

## Reusable components

Implement typed, parameter-driven Wall, Floor, Ceiling, Door, Window; kitchen cabinets, countertops, sinks, appliances; Shower, Toilet, Vanity, GlassPartition; Bed, Sofa, Wardrobe, Shelf, Table; TrackLight, Spotlight, Pendant, LEDStrip; DimensionLine and RoomLabel. Also retain Bathtub for this apartment.

Support arbitrary wall angles, real door/window openings, irregular polygons and L-shaped kitchens. Every component supports dimensions, positions, rotations and materials; attached doors/windows derive their size and transform from the host opening.

## UI — current user decision (supersedes the original editor brief)

The application is a read-only design presentation. Keep only room views, orbit/zoom/pan, optional dimensions, lighting scenarios and concise finish information. No hierarchy editor, parameter inspector, import, export, deletion, object insertion, color editing, JSON forms or Blender controls in the public interface. Do not read or overwrite old editor localStorage.

Geometry remains parametric in source JSON/TypeScript. CLI GLB/Blender tooling remains available for development; automation model injection exists only on the explicit `?export=1` page. FAST should be useful for comparing finishes without requiring Blender: restrained metric texture mapping, controlled exposure, soft shadows, readable composition. Every visual change should be checked in the actual viewport when the environment permits it; do not claim visual verification from a successful build alone.

## Correctness

- Architectural geometry is the source of truth. Never invent real apartment dimensions.
- Mark assumptions explicitly. A documented room area does not establish measured wall lengths.
- Dimensions must agree with geometry. Changes must reach both renderers.
- Test unit conversions, wall openings, polygon areas and scene exports.
- Handle textures, cameras and lighting explicitly during Blender import.
- Validate mesh identity and bounds after GLB round trip and Blender import.
- Do not add contracts, personal documents, credentials or unrelated files from the parent directory.

## Implementation order

1. Canonical schema and geometry.
2. FAST viewer.
3. Dollhouse, floor-plan and interior cameras.
4. Furniture and bathroom components.
5. Inspector and dimensions.
6. GLB export and Blender import.
7. Automated Cycles rendering.
8. FAST/PERFECT UI actions.
9. Cross-renderer consistency validation.
10. Complete workflow tests and run documentation.

Do not stop at a scaffold. Deliver the interactive viewer and offline rendering pipeline. If the environment prevents an actual run, state the exact blocker and which tests were executed; never claim a successful render without an output.

**Core rule: Edit once, visualize instantly with Three.js, and produce final architectural images using Blender Cycles without remodeling the apartment.**

## Publishing

Keep generated images, design drawings, videos, Blender scenes and render exports local by default. Do not stage or push new or modified media unless the user explicitly requests it. Existing tracked media is not automatically excluded by `.gitignore`; inspect the staged paths before every push. Publish source code, model data, tests and documentation without generated media.

## Design continuity

Read `docs/PROJECT_CONTEXT.md` and `docs/bathroom-spec.json` before proposing changes. Preserve confirmed A3/M1/T1/U1/D2 choices. Do not restore night lighting. Keep proposals separate from decisions. Design studies are inside `design/bathroom-v01`; do not depend on a sibling workspace folder. The app demo is not yet synchronized with all later design decisions; disclose this until integration is complete. Never infer actual wall lengths or quantities from room area alone.
