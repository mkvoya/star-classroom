"""Runs classroom regressions, then checks file-signaling authorization over HTTP."""
from classroom_api import call, key, teacher, a, code, BASE
import urllib.request,json
session=key()
call(a,'files-open',code=code,session=session,expected=409)
call(a,'files-ice',code=code,session=session,expected=409)
r=call(teacher,'files-open',code=code,session=session)
assert r['files']['session']==session
call(key(),'files-ice',code=code,session=session,expected=403)
call(a,'files-ice',code=code,session='wrong-session',expected=409)
ice=call(a,'files-ice',code=code,session=session)
assert ice['relay'] is False and ice['iceServers'][0]['urls']==['stun:stun.cloudflare.com:3478']
transfer=key()
r=call(a,'files-offer',code=code,session=session,id=transfer,sdp='v=0\r\nprivate offer')
assert r['files']['signals'][0]['id']==transfer
assert call(teacher,code=code)['files']['signals']==[]
new=key();call(new,'join',code=code,name='另一个学生')
def signals(k):
    req=urllib.request.Request(BASE+'?code='+code+'&files=1',headers={'x-classroom-key':k})
    return json.load(urllib.request.urlopen(req))['files']['signals']
assert signals(new)==[]
assert len(signals(teacher))==1
member=signals(teacher)[0]['memberId']
call(new,'files-answer',code=code,session=session,id=transfer,memberId=member,sdp='v=0\r\nspoof',expected=409)
call(teacher,'files-answer',code=code,session=session,id=transfer,memberId=member,sdp='v=0\r\nanswer')
assert signals(a)[0]['answer']=='v=0\r\nanswer'
assert signals(new)==[]
call(teacher,'files-close',code=code,session=session)
assert call(a,code=code)['files']['session'] is None
call(a,'files-offer',code=code,session=session,id=key(),sdp='v=0\r\nlate',expected=409)
print('PASS: authenticated file signaling, student isolation, closed-session rejection and teacher-only controls over HTTP.')

call(a,'files-ice',code=code,session=session,expected=409)
print('PASS: ICE credentials deny outsiders, expired/closed sessions and forged sessions; missing TURN configuration preserves direct transfer.')
