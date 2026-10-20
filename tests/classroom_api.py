"""Local integration checks: run against the local dev server only."""
import json, uuid, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
BASE='http://127.0.0.1:5173/api/classroom'
def key(): return str(uuid.uuid4())
def call(k, action=None, expected=200, **data):
    url=BASE if action else BASE+'?code='+data['code']
    req=urllib.request.Request(url, data=json.dumps(dict(action=action,**data)).encode() if action else None, headers={'Content-Type':'application/json','x-classroom-key':k})
    try:
        with urllib.request.urlopen(req) as r: status, body=r.status,json.load(r)
    except urllib.error.HTTPError as e: status,body=e.code,json.load(e)
    assert status==expected,(status,body,expected)
    return body
teacher,a,b,c=key(),key(),key(),key()
r=call(teacher,'create',name='测试老师'); code=r['code']
call(a,'join',code=code,name='同名同学'); call(b,'join',code=code,name='同名同学')
r=call(teacher,code=code);assert len(r['members'])==2
call(a,'start',code=code,round=0,expected=403)
r=call(teacher,'start',code=code,round=0);assert r['total']==2
call(a,'submit',code=code,round=1,answer=' ',expected=400)
call(a,'submit',code=code,round=1,answer='秘密答案甲')
for who in [teacher,b]:
    r=call(who,code=code);assert r['submitted']==1 and r['status']=='answering';assert '秘密答案甲' not in json.dumps(r,ensure_ascii=False);assert all('answer' not in m for m in r['members'])
assert call(a,code=code)['ownAnswer']=='秘密答案甲'
call(c,'join',code=code,name='迟到同学');assert call(c,code=code)['total']==2
call(c,'submit',code=code,round=1,answer='迟到答案',expected=409)
call(a,'submit',code=code,round=1,answer='修改答案',expected=409)
r=call(b,'submit',code=code,round=1,answer='秘密答案乙');assert r['status']=='revealed'
for who in [teacher,a,b,c]:
    r=call(who,code=code);assert r['status']=='revealed';assert {m.get('answer') for m in r['members']}=={'秘密答案甲','秘密答案乙',None}
r=call(teacher,'start',code=code,round=1);assert r['round']==2 and r['total']==3 and r['submitted']==0
call(teacher,'start',code=code,round=1,expected=400)
call(a,'submit',code=code,round=1,answer='过期答案',expected=409)
with ThreadPoolExecutor() as pool:
    list(pool.map(lambda k:call(k,'submit',code=code,round=2,answer='并发提交'),[a,b,c]))
assert call(teacher,code=code)['status']=='revealed'
call(teacher,'start',code=code,round=2)
call(a,'submit',code=code,round=3,answer='第三轮')
r=call(teacher,code=code)
for m in r['members']:
    if not m['submitted']: call(teacher,'remove',code=code,memberId=m['id'])
assert call(a,code=code)['status']=='revealed'
call(b,code=code,expected=403)
call(key(),code=code,expected=403)
call('invalid',code=code,expected=401)
r=call(a,'join',code=code,name='名字已记住');assert len(r['members'])==1
print('PASS: member visibility, duplicate names, server-side answer concealment, teacher permissions, late joins, auto-reveal, concurrent submissions, round reset, stale/duplicate validation, removal, device rejoin and room isolation.')
