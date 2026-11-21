from screen import S
from lif import *
from multiprocessing import Pool
import pickle
jobs=[]
for k in ['sugarL','sugarR']:
    for r in [40,80,150]: jobs.append((k,r))
for k in ['bitterL','bitterR','antL','antR']:
    for r in [60,150]: jobs.append((k,r))
for k in ['VL','VR']: jobs.append((k,30))
jobs+= [('sugarL+bitterL',100),('sugarL+sugarR',80),('sugarR+antR',100),('sugarL+antL',100)]
def run(j):
    k,r=j; st={}
    for kk in k.split('+'):
        for i in S[kk]: st[i]=r
    return j, sim(st,T=500,seed=4)
if __name__=='__main__':
    with Pool(4) as p: R=p.map(run,jobs)
    pickle.dump(R,open('s4.pkl','wb'))
    for j,c in R: print(j,(c>0).sum())
