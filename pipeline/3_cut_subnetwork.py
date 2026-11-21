from screen import S
from lif import *
import pickle
R=pickle.load(open('s4.pkl','rb'))
keep=np.zeros(N,bool)
for j,c in R:
    if (c>0).sum()<3000: keep|=c>0
for k in S:
    if not k.startswith(('V','head','JO','DM1')): keep[S[k]]=True
sub=np.nonzero(keep)[0]; print('sub neurons',len(sub))
Ws=W[sub][:,sub].tocsc(); print('edges',Ws.nnz)
pickle.dump((sub,Ws),open('sub.pkl','wb'))
