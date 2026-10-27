# GooeyCore Studio (web)

A browser-based block designer, assembler and simulator for the FXCore DSP.
Live at https://gs.experimentalnoize.com/

## Running locally

The app is plain HTML and JavaScript with no build step. Serve the folder
with any static web server and open it in a browser, for example:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

Programming a device over USB (FT260 HID) needs a browser with WebHID
support, such as Chrome or Edge.

## Files

- `index.html` – the page, its styles and UI wiring
- `gooeycore_studio.js` – the block designer
- `assembler.js`, `preprocessor.js`, `line_parse.js`, `shunting_yard.js`,
  `symbol_table.js`, `mnemonic.js`, `registers.js`, `reserved_words.js`,
  `intel_hex.js`, `program.js`, `common.js`, `debug_config.js` – the FXCore assembler
- `fxcore-emu.js`, `fxcore-sim.js`, `fxcore-midi.js`, `fxcore_ic.js` – emulator and simulator
- `fxl_library.js` – block library
- `FT260_wrap.js`, `FXCoreTargets.js`, `FXCoreProgrammer.js`, `FXCoreFunctions.js` – device programming

## License

MIT – see [LICENSE](LICENSE).
