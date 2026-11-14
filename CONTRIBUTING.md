# Contributing a scene

1. **Pick the game(s)**: `games[].system` is Lumen's system id, `serials` the disc serials
   (all regions and discs you know of: they come from redump names like `SCUS-94163`). For
   cartridges, the `title` is matched instead.
2. **Make the folder** `scenes/<game>-<name>/` (lowercase, dashes; the same as `id`).
3. **Model** in Blender or any tool that exports Wavefront OBJ with materials. Colour comes
   from the material: `Kd` for lit faces, `Ke` (Emission in Blender) for lights. Keep the
   whole scene under 20 000 triangles; 2 000 - 6 000 is plenty.
4. **Music** (optional): a Standard MIDI File you composed, at most 5 minutes. Put an intro
   before a CC 111 and the rest loops. Listen to it in the preview: Lumen has its own small
   synthesizer, not a General MIDI sound bank.
5. **Check**: `npm run preview`, then `npm run validate` and `npm run index` (commit the
   updated `index.json`).
6. **Pull request**: describe the scene and confirm that every asset is your own work.

Sources (generator scripts, `.blend` files) go in `source/`; they are never copied to the
stick. Raise `version` whenever you change a published scene so the library manager offers
the update.

## Not accepted

- Characters, logos, models, textures, screenshots or sprites from the game or any other work.
- Transcriptions or arrangements of the game's music (MIDI included).
- Scenes over the limits in FORMAT.md, or that fail `npm run validate`.
