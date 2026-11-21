import numpy as np, pandas as pd, scipy.sparse as sp, time
D='./data/'
comp=pd.read_csv(D+'Drosophila_brain_model/Completeness_783.csv',index_col=0)
ids=comp.index.values.astype(np.int64); N=len(ids); id2i={v:i for i,v in enumerate(ids)}
con=pd.read_parquet(D+'Drosophila_brain_model/Connectivity_783.parquet')
pre=con.Presynaptic_Index.values; post=con.Postsynaptic_Index.values
w=con['Excitatory x Connectivity'].values*0.275
W=sp.csc_matrix((w,(post,pre)),shape=(N,N))  # column=pre
ann=pd.read_csv(D+'ann.tsv',sep='\t',dtype=str); ann['root_id']=ann.root_id.astype(np.int64)
ann=ann.set_index('root_id')
def sim(stim, T=1000, dt=0.1, seed=0, silence=None, Wm=None):
    """stim: dict idx->rate Hz. returns spike counts per neuron"""
    Wm = W if Wm is None else Wm
    rng=np.random.default_rng(seed)
    v=np.full(N,-52.0); g=np.zeros(N); rf=np.zeros(N)
    nst=int(T/dt); dly=18; buf=[np.array([],int)]*dly
    cnt=np.zeros(N,np.int32)
    si=np.array(list(stim.keys()),int); sr=np.array(list(stim.values()))*dt/1000
    for t in range(nst):
        d=buf[t%dly]
        if len(d): g+=np.asarray(Wm[:,d].sum(axis=1)).ravel()
        act=rf<=0
        v[act]+= dt*(-52.0-v[act]+g[act])/20.0
        g[act]-= g[act]*dt/5.0
        rf-=dt
        if len(si):
            hit=si[rng.random(len(si))<sr]; v[hit]+=68.75
        s=np.nonzero(v>-45.0)[0]
        v[s]=-52.0; g[s]=0; rf[s]=2.2; rf[si]=np.minimum(rf[si],0) if len(si) else 0
        cnt[s]+=1
        buf[t%dly]=s
    return cnt
