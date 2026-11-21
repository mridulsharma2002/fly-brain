# Fit the linear left/right sugar decoder on all simulated runs and add it,
# plus a 6,000-point whole-brain silhouette, to ../brain.json.
import pickle, json, numpy as np, pandas as pd
from lif import ann, ids
out, res = pickle.load(open('t9.pkl', 'rb'))
X = np.array([r[2] for r in res]); X = np.hstack([X, np.ones((len(X), 1)) * 100])
y = np.array([(r[0] - r[1]) / 150 for r in res])
w = np.linalg.solve(X.T @ X + 1e3 * np.eye(X.shape[1]), X.T @ y)
keep = np.nonzero(np.abs(w[:-1]) > 1e-5)[0]
d = json.load(open('../brain.json'))
d['decoder'] = [[int(out[k]), round(float(w[k]), 6)] for k in keep]
d['decBias'] = round(float(w[-1] * 100), 5)
a = ann.reindex(ids)
c = a[a.super_class.isin(['central','descending','ascending','sensory','motor','visual_projection','optic'])]
x = pd.to_numeric(c.pos_x, errors='coerce').values; yy = pd.to_numeric(c.pos_y, errors='coerce').values
m = ~np.isnan(x); x, yy = x[m], yy[m]
k = np.random.default_rng(0).choice(len(x), 6000, replace=False)
d['bg'] = [int(v) for p in zip(x[k], yy[k]) for v in p]; d['bgN'] = len(x)
# (later) z coordinates for the 3D view: neuron soma_z/pos_z as d['z'], silhouette pos_z as d['bgz']
json.dump(d, open('../brain.json', 'w'), separators=(',', ':'))
