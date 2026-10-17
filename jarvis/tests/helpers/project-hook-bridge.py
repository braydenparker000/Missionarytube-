"""Test-only pipe transport: real Python serialization into real workerd HTTP."""
import importlib.util
import json
import sys
from pathlib import Path

spec=importlib.util.spec_from_file_location('project_hook',Path(__file__).resolve().parents[2]/'scripts/lib/project_hook.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def request(op,payload):
    read=op in ('identity','events','work','message')
    print(json.dumps({'request':{'op':op,'query':payload if read else None,'body':None if read else json.dumps(payload,ensure_ascii=False)}},ensure_ascii=False),flush=True)
    result=json.loads(sys.stdin.readline())
    if result['status']>=400:
        raise module.RemoteError(result['status'],result['data'].get('error','unknown'))
    return result['data']

hook=module.Hook(sys.argv[1],request)
try:
    poll=hook.poll()
    if sys.argv[2]=='complete':
        assert poll['wake'] and poll['claim']
        # NUL escapes are the largest legal JSON representation per code unit.
        answer='\x00'*6000 if sys.argv[3]=='control' else '😀'*3000
        result=hook.complete(poll['message']['id'],poll['claim']['work']['runId'],answer,'😀'*500)
        assert result['work']['state']=='reported'
        print(json.dumps({'result':{'completed':True,'replyId':result['work']['result']['replyId']}}),flush=True)
    else:
        assert poll['wake'] and poll['notifications'] and 'claim' not in poll
        hook.consume([n['event']['id'] for n in poll['notifications']])
        assert not hook.poll()['wake']
        print(json.dumps({'result':{'consumed':len(poll['notifications'])}}),flush=True)
finally:
    hook.close()
