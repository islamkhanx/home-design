Place local PNG/JPEG texture files here. Reference `/textures/filename.png` from MaterialDef.texture or normalTexture. The GLB exporter embeds these images; Blender preserves the imported material nodes. Do not put private files in public/.

Run `npm run textures:fetch` to obtain the referenced product photographs locally. A source-only checkout remains usable without them: the browser and headless exporter retain procedural/base materials and report missing textures. These fallback surfaces are approximate, not product photographs.


`laparet-noa/wall.jpg` and `floor.jpg` are original product photographs downloaded from the two selected Santehnica Shop catalogue entries. See `laparet-noa/sources.json` for source URLs, date and SHA-256. They are not AI images or measured PBR scans. Nominal 1.2 × 0.6 m / 0.6 × 0.6 m metric mapping is preserved in both export paths; actual laying dimensions require tile calibre and grout selection. Roughness/normal maps remain approximations. These images stay local under the project's media rule; source copyrights remain with their owners. Do not claim an open licence.
