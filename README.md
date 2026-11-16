# Iron District

A round-based tactical FPS for three.js-fps-01. You are **Coal**, defending the
district device at the north-west site. The **Torch** squad — three bots — walks
lanes, hunts you, and plants the device. Win a round by eliminating Torch, by the
clock running out, or by defusing a planted device; lose it if they plant and the
fuse burns out or they eliminate you.

## Play

```
node serve.ts          # game/ on http://localhost:8080
```

Then open http://localhost:8080 in a desktop browser and click to play.

- **WASD** move, **mouse** look, **click** fire, **R** reload
- **Ctrl/C** crouch, **Space** jump
- **G** grenade, **E** (hold, at the device) defuse
- **B** buy menu during the buy phase: SMG $1600, Carbine $2700, DMR $3800, grenade $300
- Money: $3250 a round won, $1400 lost, $300 a kill, capped at $9000
- Buy 10 s, live 100 s, plant 3.5 s, fuse 35 s, defuse 6 s

## Deterministic captures

`?shot=start|play&end&seed=N` freezes a deterministic frame and sets
`window.__shotReady` once it has painted twice — no audio, no timers that drift.
`shots.json` lists the three captures; `node main.ts` copies `game/` and
`screenshots/` to `/output` (or `$MAKEFUN_OUTPUT_DIR`) and writes `dossier.json`
with the kit's vendored `buildDossier`.

## Layout

- `game/` — the playable game, plain static ES modules, three.js 0.187.0 vendored
- `game/src/` — one module per job: `world` (map), `physics` (movement, LOS),
  `combat` (hitscan, guns), `player`, `weapon`, `bots`, `rounds`, `device`,
  `grenades`, `hud`, `input`, `palette`, `main` (boot and the fixed-step loop)
- `main.ts` — the program: copies the entry to /output and writes the dossier
- `serve.ts` — a tiny static server for local play
- `screenshots/` — three deterministic captures of the game

MIT licensed. Original map, names and art.
