# Pipeline

How `brain.json` was made. Python 3, numpy, scipy, pandas, pyarrow.

Put these in `pipeline/data/`:
- `Completeness_783.csv`, `Connectivity_783.parquet` from [philshiu/Drosophila_brain_model](https://github.com/philshiu/Drosophila_brain_model) (FlyWire v783)
- `ann.tsv` = `Supplemental_file1_neuron_annotations.tsv` from [flyconnectome/flywire_annotations](https://github.com/flyconnectome/flywire_annotations)

Then, from this folder:

1. `lif.py`: whole-brain leaky integrate-and-fire model (138,639 neurons), same equations and constants as Shiu et al. 2024, in numpy.
2. `screen.py`: sensor groups (sugar, bitter, antenna touch, left and right).
3. `2_probe_senses.py`: runs the full brain for each sense at several strengths. Runs that tip into the model's runaway state (10,000+ neurons) are dropped.
4. `3_cut_subnetwork.py`: keeps every neuron that fired in a stable run, plus all connections between them (867 neurons, 40,722 connections).
5. `subsim.py`, `4_export.py`: re-runs the cut network to check it matches, then writes `../brain.json`.
6. `5a_decoder_runs.py`, `5b_decoder_runs_more.py`, `6_fit_decoder.py`: 440 runs with different left/right sugar, then a ridge-regression decoder from the output neurons.
