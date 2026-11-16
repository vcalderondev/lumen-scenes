# Lumen scenes

Animated, low-poly backgrounds with MIDI music for the games in
[Lumen PSX](https://github.com/vcalderondev/lumen-psx), the home screen for the PlayStation
Classic. When you select a game, Lumen draws its scene behind the dashboard and plays its
music. The [library manager](https://lpsx.dev/admin) finds the scenes made for the
games on your USB stick and installs them in one click.

Each scene is a small folder: a `scene.json` with layers (sky gradient, stars, flat-shaded
OBJ models, particles, glows), a few low-poly models and an optional MIDI file. No textures,
no video: a scene is tens to hundreds of kilobytes.

| Scene | For | |
|---|---|---|
| [Reactor City](scenes/ffvii-reactor-city) | Final Fantasy VII | an industrial city at night, green reactors, an airship |
| [Motes of Light](scenes/ffvii-lifestream) | Final Fantasy VII | darkness and green motes of light drifting up |

## Preview

```sh
npm run preview        # http://localhost:8130/player/preview.html
```

The preview uses the reference player (`player/`), the same math, shaders and MIDI synth
Lumen uses on the console. Tick *Lumen dashboard scrim* to see it as it looks behind the
dashboard. *My own MIDI…* plays any MIDI file through Lumen's synth (it stays in your
browser).

## Contributing a scene

See [CONTRIBUTING.md](CONTRIBUTING.md) and the format in [FORMAT.md](FORMAT.md). In short:

1. `scenes/<game>-<name>/scene.json` + `models/*.obj|mtl` + `music.mid`, all **your own
   work** under CC0-1.0, CC-BY-4.0 or CC-BY-SA-4.0.
2. `npm run validate` and `npm run index`, then open a pull request.

## What is not accepted

Scenes are original works *for* a game, not copies *of* it: no characters, logos, models,
textures, screenshots or music from the game (including MIDI transcriptions of its
soundtrack). If you want a game's own music on your console, the library manager lets you
add your own MIDI file to a game. It is written to your stick only.

## License

Tools and player: MIT (`LICENSE`). Each scene's assets: the license in its `scene.json`.
