from subsim import *
from multiprocessing import Pool
out=np.nonzero(a.super_class.isin(['descending','motor']).values)[0]
rng=np.random.default_rng(11)
conds=[]
for k in range(320):
    base=rng.uniform(25,150); ratio=np.exp(rng.uniform(-0.7,0.7))
    L=min(150,base*np.sqrt(ratio)); R=min(150,base/np.sqrt(ratio))
    conds.append((L,R,k+1000))
def run(c):
    L,R,k=c; x=sim({'sugarL':L,'sugarR':R},T=500,seed=k); return L,R,x[out]*2.0
if __name__=='__main__':
    with Pool(4) as p: res=p.map(run,conds)
    old=pickle.load(open('t8.pkl','rb'))[1]
    res=res+old
    pickle.dump((out,res),open('t9.pkl','wb'))
    X=np.array([r[2] for r in res]); X=np.hstack([X,np.ones((len(X),1))*100]); y=np.array([(r[0]-r[1])/150 for r in res])
    idx=np.random.default_rng(0).permutation(len(y)); te=idx[:80]; tr=idx[80:]
    for lam in [3e2,1e3,3e3,1e4]:
        A=X[tr]; w=np.linalg.solve(A.T@A+lam*np.eye(A.shape[1]),A.T@y[tr])
        pr=X[te]@w; print(lam,'r %.3f sign %.2f'%(np.corrcoef(pr,y[te])[0,1],(np.sign(pr)==np.sign(y[te])).mean()))
