from subsim import *
import json, base64
res=pickle.load(open('t5.pkl','rb'))
ct=a.cell_type.fillna('').values; sd=a.side.fillna('').values
def find(t,s): return [i for i in range(n) if ct[i]==t and sd[i].startswith(s)]
R={'feed':find('CB0701',''),
   'tasteL':find('DNge031','l')+find('DNge023','l'),'tasteR':find('DNge031','r')+find('DNge023','r'),
   'bitterL':find('DNp42','l')+find('DNge067','l'),'bitterR':find('DNp42','r')+find('DNge067','r'),
   'touchL':find('DNg35','l')+find('DNg84','l'),'touchR':find('DNg35','r')+find('DNg84','r')}
print({k:len(v) for k,v in R.items()})
role=[]
for i in range(n):
    sc=a.super_class.iloc[i]
    role.append('s' if sc in('sensory','sensory_ascending') else 'o' if sc in ('descending','motor') else 'i')
def num(x):
    try: return float(x)
    except: return np.nan
xs=[];ys=[]
for i in range(n):
    x=num(a.soma_x.iloc[i]); y=num(a.soma_y.iloc[i])
    if np.isnan(x): x=num(a.pos_x.iloc[i]); y=num(a.pos_y.iloc[i])
    xs.append(x); ys.append(y)
xs=np.array(xs); ys=np.array(ys)
xs=np.where(np.isnan(xs),np.nanmean(xs),xs); ys=np.where(np.isnan(ys),np.nanmean(ys),ys)
# CSR by pre: for each pre, list of (post, nsyn signed)
C=Ws.tocsc(); C.sort_indices()
ptr=C.indptr.astype(np.int32); post=C.indices.astype(np.int16); w=np.rint(C.data/0.275).astype(np.int16)
b=lambda arr: base64.b64encode(arr.tobytes()).decode()
nt=a.top_nt.fillna('').values
data={'n':int(n),'ids':[str(ids[sub[i]]) for i in range(n)],'type':list(ct),'side':[s[:1] for s in sd],
 'cls':list(a.super_class.fillna('').values),'nt':list(nt),'role':role,
 'x':[round(float(v)) for v in xs],'y':[round(float(v)) for v in ys],
 'ptr':b(ptr),'post':b(post),'w':b(w),'sensors':P,'readouts':R,'flywire':'v783','wsyn':0.275}
open('../brain.json','w').write(json.dumps(data,separators=(',',':')))
import os; print(os.path.getsize('../brain.json'), 'edges',C.nnz, 'max w',abs(w).max())
for k in ['sugarL','sugarR','bitterL','bitterR','antL','antR']:
    c=res[k]; print(k,{r:int(c[v].sum()) for r,v in R.items()})
