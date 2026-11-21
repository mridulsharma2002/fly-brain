# Fly Brain NPC

A game character driven by a real fruit fly brain wiring diagram.

- **Play:** drop sugar, lemons and walls, and do brain surgery (switch neurons off).
- **Race the NPC:** the brain fly against a hand-written behaviour-tree fly with the same senses.
- **Evolve a swarm:** 6-10 flies with mutated wiring; the best sugar hunters survive each generation.
- **Levels:** 5 presets, plus build your own, save it, and share it as a link.
- **3D brain:** the whole fly brain at its real shape, with the game's neurons lighting up as they fire.

Brains run in Web Workers (`worker.js`) so the page stays smooth on phones. If a device can't keep up, the whole world slows down evenly rather than dropping frames.

Live: https://fly.mridulmerges.ca

## What's real and what isn't

- **Real:** the wiring. 867 neurons and 40,722 connections from the [FlyWire](https://flywire.ai) adult fly brain connectome (v783), cut out of the full 139k-neuron brain by running the whole thing and keeping every neuron that fires for sugar, bitter and touch. The neuron model is the leaky integrate-and-fire model from Shiu et al. 2024, running live in your browser (0.2 ms steps; the paper uses 0.1 ms, and the behaviour is the same here).
- **Mine:** the body. A few lines in `app.js` (`stepBody`) turn output-neuron firing into walking, turning, backing up and eating. Feeding is the real MN9 proboscis motor neuron. Left/right sugar is read by a linear decoder over ~100 output neurons.
- Real flies find food from a distance by smell. The model's smell circuit runs away (10,000+ neurons firing), so sugar enters through taste neurons instead.

See `pipeline/` for how `brain.json` was built.

## Run locally

Any static server: `python3 -m http.server` and open http://localhost:8000.

## Credits

- Connectome: FlyWire Consortium. Dorkenwald et al., *Neuronal wiring diagram of an adult brain*, Nature 2024; Schlegel et al., *Whole-brain annotation and multi-connectome cell typing of Drosophila*, Nature 2024. Data CC BY 4.0 (Zenodo 10.5281/zenodo.10676866).
- Model: Shiu et al., *A Drosophila computational brain model reveals sensorimotor processing*, Nature 2024. Code MIT.
- Built by [Mridul Sharma](https://mridulmerges.ca).

Code in this repo: MIT.
