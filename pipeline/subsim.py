import numpy as np, pickle, pandas as pd
from lif import ann, ids
from screen import S
sub,Ws=pickle.load(open('sub.pkl','rb'))
n=len(sub); pos={g:i for i,g in enumerate(sub)}
a=ann.reindex(ids[sub])
P={k:[pos[i] for i in v if i in pos] for k,v in S.items() if not k.startswith(('V','head','JO','DM1'))}
def sim(rates, T=500, dt=0.1, seed=0):
    rng=np.random.default_rng(seed)
    v=np.full(n,-52.0); g=np.zeros(n); rf=np.zeros(n); buf=[np.array([],int)]*18; cnt=np.zeros(n,int)
    st={}
    for k,r in rates.items():
        for i in P[k]: st[i]=r
    si=np.array(list(st),int); sr=np.array(list(st.values()))*dt/1000
    for t in range(int(T/dt)):
        d=buf[t%18]
        if len(d): g+=np.asarray(Ws[:,d].sum(axis=1)).ravel()
        act=rf<=0; v[act]+=dt*(-52-v[act]+g[act])/20; g[act]-=g[act]*dt/5; rf-=dt
        if len(si): h=si[rng.random(len(si))<sr]; v[h]+=68.75
        s=np.nonzero(v>-45)[0]; v[s]=-52; g[s]=0; rf[s]=2.2; cnt[s]+=1; buf[t%18]=s
    return cnt
