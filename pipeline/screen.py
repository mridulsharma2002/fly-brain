from lif import *
import sys, pickle
from multiprocessing import Pool
def g(mask): return [id2i[i] for i in ann[mask].index if i in id2i]
S={}
for side,k in [('left','L'),('right','R')]:
    sd=ann.side==side
    S['sugar'+k]=g(sd&(ann.cell_sub_class.isin(['sugar','sugar/low_salt'])))
    S['bitter'+k]=g(sd&(ann.cell_sub_class=='bitter'))
    S['DM1'+k]=g(sd&(ann.cell_type=='ORN_DM1'))
    S['V'+k]=g(sd&(ann.cell_type=='ORN_V'))
    S['ant'+k]=g(sd&(ann.cell_type=='BM_Ant'))
    S['head'+k]=g(sd&(ann.cell_type=='BM_InOm'))
    S['JO'+k]=g(sd&(ann.cell_type.fillna('').str.startswith('JO-')))
def run(k): return k, sim({i:150 for i in S[k]},T=500,seed=1)
if __name__=='__main__':
    with Pool(4) as p: R=dict(p.map(run,list(S)))
    pickle.dump((S,R),open('screen.pkl','wb'))
