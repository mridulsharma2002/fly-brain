from subsim import *
from multiprocessing import Pool
out=np.nonzero(a.super_class.isin(['descending','motor']).values)[0]
rng=np.random.default_rng(7)
conds=[]
for k in range(120):
    base=rng.uniform(30,150); diff=rng.uniform(-0.5,0.5)*base
    L=np.clip(base+diff/2,0,150); R=np.clip(base-diff/2,0,150)
    if k%6==0: L,R=(rng.uniform(40,150),0) if k%12==0 else (0,rng.uniform(40,150))
    conds.append((L,R,k))
def run(c):
    L,R,k=c; x=sim({'sugarL':L,'sugarR':R},T=400,seed=k); return L,R,x[out]*2.5
if __name__=='__main__':
    with Pool(4) as p: res=p.map(run,conds)
    pickle.dump((out,res),open('t8.pkl','wb'))
    X=np.array([r[2] for r in res]); y=np.array([(r[0]-r[1])/150 for r in res])
    tr=np.arange(len(y))<90
    best=None
    for lam in [1e2,1e3,1e4,1e5]:
        A=X[tr]; w=np.linalg.solve(A.T@A+lam*np.eye(A.shape[1]),A.T@y[tr])
        pr=X[~tr]@w; r=np.corrcoef(pr,y[~tr])[0,1]; sgn=(np.sign(pr)==np.sign(y[~tr])).mean()
        print(lam,'test r %.2f sign acc %.2f nonzero'%(r,sgn))
