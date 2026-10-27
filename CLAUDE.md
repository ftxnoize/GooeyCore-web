# GooeyCore Studio (web)

Plain HTML/JS, no build step. Serve the folder with any static server to run it.

## Build number

The toolbar shows "Build NN" next to GOOEYCORE STUDIO (`#build-label` in
`index.html`). Increase it by one with every update to the `main` branch,
as part of the change that goes to `main`.

## Shared engine

The assembler, emulator and simulator files are shared with the FXCore
assembler site at https://fxcore.sandboxpedal.com/. GooeyCore-only
additions in `fxcore-sim.js` (the Impulse source and the `simDbg*`
debugger API at the end of the file) must be kept when syncing from there.
