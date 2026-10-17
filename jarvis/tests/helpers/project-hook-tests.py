import importlib.util
import json
import tempfile
import contextlib
import fcntl
import io
import os
import signal
import sys
import time
from unittest import mock
import unittest
from datetime import datetime, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location('project_hook', Path(__file__).resolve().parents[2] / 'scripts/lib/project_hook.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Hook, RemoteError = module.Hook, module.RemoteError


def iso(n):
    return datetime.fromtimestamp(n / 1000, timezone.utc).isoformat().replace('+00:00', 'Z')


class Server:
    def __init__(self):
        self.now = 1000000
        self.events = [{'id':'event-1','messageId':'request-1'}]
        self.item = {'messageId':'request-1','state':'pending','runId':None,'nextAttemptAt':iso(self.now),'leaseUntil':None,'fence':0}
        self.detail = {'work':self.item, 'message':{'id':'request-1','sender':'lucy','kind':'request','body':'$(never execute this)'},'acceptedReply':None}
        self.claim_id = None
        self.loss = None
        self.ack = False
        self.send_count = 0
        self.agent = 'mast'

    def request(self, op, args):
        if op == 'identity':
            return {'project':'jarvis','agent':self.agent}
        if op == 'events':
            return {'events':self.events if args.get('mode')=='replay' else ([] if self.ack else self.events),'nextCursor':None}
        if op == 'ack':
            self.ack = True
            result = {'acknowledged':args['eventIds']}
        elif op == 'work':
            return {'work':[] if self.item['state']=='reported' else [dict(self.item)],'nextCursor':None}
        elif op == 'claim':
            if self.item['state']=='claimed' and module.milliseconds(self.item['leaseUntil']) <= self.now and not self.detail['acceptedReply']:
                self.item['state']='unknown'
                return {'work':dict(self.item),'claimId':None}
            if self.item['state'] == 'claimed' and self.item['leaseUntil'] and module.milliseconds(self.item['leaseUntil']) > self.now and self.item['runId'] != args['runId']:
                raise RemoteError(409,'already_claimed')
            if self.item['runId'] != args['runId']:
                self.item.update(state='claimed',runId=args['runId'],leaseUntil=iso(self.now+300000),fence=self.item['fence']+1)
                self.claim_id = 'claim-'+str(self.item['fence'])
            result = {'work':dict(self.item),'claimId':self.claim_id}
        elif op == 'message':
            return self.detail
        elif op == 'send':
            if args['claimId'] != self.claim_id or module.milliseconds(self.item['leaseUntil']) <= self.now:
                raise RemoteError(409,'stale_claim')
            if not self.detail['acceptedReply']:
                self.send_count += 1
                self.detail['acceptedReply'] = {'id':'accepted-reply','body':args['body']}
            result = {'message':self.detail['acceptedReply']}
        elif op == 'result':
            if args['claimId'] != self.claim_id or module.milliseconds(self.item['leaseUntil']) <= self.now:
                raise RemoteError(409,'stale_claim')
            self.item['state']='reported'
            result={'work':dict(self.item)}
        elif op == 'renew':
            self.item['leaseUntil']=iso(self.now+300000)
            return {'work':dict(self.item)}
        elif op == 'release':
            self.item.update(state='pending',leaseUntil=iso(self.now),nextAttemptAt=iso(self.now+10000))
            return {'work':dict(self.item)}
        else:
            raise AssertionError(op)
        if self.loss == op:
            self.loss = None
            raise OSError('fictional response loss')
        return result


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.server = Server()
        self.path = Path(self.temp.name)/'journal.sqlite'
        self.open()

    def open(self):
        self.hook=Hook(self.path,self.server.request,lambda:self.server.now)

    def restart(self):
        self.hook.close()
        self.open()

    def tearDown(self):
        self.hook.close()
        self.temp.cleanup()

    def test_reply_and_note_notification_requires_separate_host_receipt(self):
        self.server.item['state']='reported'
        self.server.detail['message']['kind']='reply'
        first=self.hook.poll()
        self.assertTrue(first['wake'])
        self.assertEqual(first['notifications'][0]['event']['id'],'event-1')
        self.restart()
        again=self.hook.poll()
        self.assertEqual(first['notifications'][0]['dispatchKey'],again['notifications'][0]['dispatchKey'])
        self.assertTrue(self.server.ack)
        self.hook.consume(['event-1'])
        self.assertFalse(self.hook.poll()['wake'])

    def test_lost_final_result_response_reconciles_without_model_and_complete_retries(self):
        wake=self.hook.poll()
        run=wake['claim']['work']['runId']
        self.server.loss='result'
        with self.assertRaises(OSError): self.hook.complete('request-1',run,'Accepted','Done')
        self.restart()
        self.assertFalse(self.hook.poll()['wake'])
        self.assertEqual(self.hook.db.execute('SELECT COUNT(*) FROM runs').fetchone()[0],0)
        self.assertEqual(self.hook.complete('request-1',run,'Accepted','Done')['work']['state'],'reported')
        with self.assertRaises(ValueError): self.hook.complete('request-1',run,'Overwrite','Done')
        self.assertEqual(self.server.send_count,1)

    def test_lost_journal_replays_acknowledged_reply_with_stable_notification_key(self):
        self.server.item['state']='reported'
        self.server.detail['message']['kind']='reply'
        first=self.hook.poll()
        self.hook.consume(['event-1'])
        self.hook.close()
        self.path.unlink()
        self.open()
        recovered=self.hook.poll()
        self.assertTrue(recovered['wake'])
        self.assertEqual(first['notifications'][0]['dispatchKey'],recovered['notifications'][0]['dispatchKey'])

    def test_utf16_limits_reject_before_staging(self):
        wake=self.hook.poll()
        run=wake['claim']['work']['runId']
        for body, summary in [('😀'*3001,'Done'),('Valid','😀'*501),('\ufeff','Done'),('Valid','\ufeff')]:
            with self.assertRaises(ValueError): self.hook.complete('request-1',run,body,summary)
            self.assertIsNone(self.hook.db.execute('SELECT completion FROM runs').fetchone()[0])
        self.assertEqual(self.hook.complete('request-1',run,'😀'*3000,'😀'*500)['work']['state'],'reported')

    def test_slow_notification_hydration_makes_durable_progress_across_budgets(self):
        self.server.item['state']='reported'
        self.server.detail['message']['kind']='reply'
        self.server.events=[{'id':f'event-{i}','messageId':f'reply-{i}'} for i in range(20)]
        original=self.server.request
        used, reads = [0], [0]
        def limited(op,args):
            used[0]+=1
            if used[0]>7:
                raise RemoteError(503,'hook_budget_exhausted')
            if op=='message': reads[0]+=1
            return original(op,args)
        self.hook.request=limited
        result=None
        for _ in range(12):
            used[0]=0
            try:
                result=self.hook.poll()
                break
            except RemoteError as error:
                self.assertEqual(error.code,'hook_budget_exhausted')
        self.assertIsNotNone(result)
        self.assertEqual(len(result['notifications']),20)
        self.assertEqual(reads[0],20,'successful hydration must not repeat after a budget interruption')

    def test_slow_work_scan_resumes_pages_independently_of_events(self):
        self.server.events=[]
        original=self.server.request
        used=[0]
        def limited(op,args):
            used[0]+=1
            if used[0]>4: raise RemoteError(503,'hook_budget_exhausted')
            if op=='work':
                n=int(args.get('cursor','0'))
                return {'work':[], 'nextCursor':str(n+1) if n<4 else None}
            return original(op,args)
        self.hook.request=limited
        with self.assertRaises(RemoteError): self.hook.poll()
        self.assertEqual(self.hook.db.execute("SELECT value FROM meta WHERE key='work_cursor'").fetchone()[0],'2')
        used[0]=0
        with self.assertRaises(RemoteError): self.hook.poll()
        self.assertEqual(self.hook.db.execute("SELECT value FROM meta WHERE key='work_cursor'").fetchone()[0],'4')
        used[0]=0
        self.assertFalse(self.hook.poll()['wake'])
        self.assertIsNone(self.hook.db.execute("SELECT value FROM meta WHERE key='work_cursor'").fetchone())

    def test_idle_does_not_wake_model(self):
        self.server.item['state']='reported'
        self.assertFalse(self.hook.poll()['wake'])
        self.assertFalse(self.hook.poll()['wake'])

    def test_event_is_durable_before_uncertain_ack_and_retry_deduplicates(self):
        self.server.loss='ack'
        with self.assertRaises(OSError): self.hook.poll()
        self.assertEqual(self.hook.db.execute('SELECT COUNT(*) FROM events').fetchone()[0],1)
        self.assertEqual(self.hook.db.execute('SELECT acked FROM events').fetchone()[0],0)
        self.restart()
        wake=self.hook.poll()
        self.assertTrue(wake['wake'])
        self.assertEqual(self.hook.db.execute('SELECT COUNT(*) FROM events').fetchone()[0],1)
        self.assertEqual(self.hook.db.execute('SELECT acked FROM events').fetchone()[0],1)

    def test_claim_response_loss_reuses_run_and_dispatch_key(self):
        self.server.loss='claim'
        with self.assertRaises(OSError): self.hook.poll()
        run=self.server.item['runId']
        self.restart()
        one=self.hook.poll()
        two=self.hook.poll()
        self.assertEqual(one['claim']['work']['runId'],run)
        self.assertEqual(one['dispatchKey'],two['dispatchKey'])
        self.assertEqual(one['message']['body'],'$(never execute this)')

    def test_expiry_recovers_acknowledged_work_after_journal_loss(self):
        first=self.hook.poll()
        self.hook.close()
        self.path.unlink()
        self.open()
        self.assertFalse(self.hook.poll()['wake'])
        self.server.now+=300001
        self.assertFalse(self.hook.poll()['wake'])
        self.assertEqual(self.server.item['state'],'unknown')
        # An explicit separately reconciled retry reopens work; expiry alone does not.
        self.server.item['state']='pending'
        second=self.hook.poll()
        self.assertTrue(second['wake'])
        self.assertNotEqual(first['dispatchKey'],second['dispatchKey'])
        self.assertEqual(second['claim']['work']['fence'],2)

    def test_accepted_reply_response_loss_never_reexecutes_model_or_overwrites(self):
        wake=self.hook.poll()
        self.server.loss='send'
        with self.assertRaises(OSError): self.hook.complete('request-1',wake['claim']['work']['runId'],'Accepted','Done')
        self.restart()
        recovered=self.hook.poll()
        self.assertFalse(recovered['wake'])
        self.assertEqual(recovered['recovered'],'request-1')
        self.assertEqual(self.server.send_count,1)
        self.assertEqual(self.server.item['state'],'reported')

    def test_staged_completion_survives_expired_lease(self):
        wake=self.hook.poll()
        self.server.now+=300001
        with self.assertRaises(RemoteError): self.hook.complete('request-1',wake['claim']['work']['runId'],'Saved local draft','Done')
        self.restart()
        self.assertFalse(self.hook.poll()['wake'])
        self.assertEqual(self.server.item['state'],'unknown')
        self.assertEqual(self.server.send_count,0)
        self.server.item['state']='pending'
        self.assertFalse(self.hook.poll()['wake'])
        self.assertEqual(self.server.send_count,1)
        self.assertEqual(self.server.detail['acceptedReply']['body'],'Saved local draft')

    def test_old_host_cannot_complete_after_new_local_claim(self):
        first=self.hook.poll()
        self.server.now+=300001
        self.assertFalse(self.hook.poll()['wake'])
        self.server.item['state']='pending'
        second=self.hook.poll()
        with self.assertRaises(ValueError): self.hook.complete('request-1',first['claim']['work']['runId'],'Old output','Done')
        self.assertNotEqual(first['dispatchKey'],second['dispatchKey'])

    def test_identity_change_fails_closed(self):
        self.hook.poll()
        self.server.agent='lucy'
        with self.assertRaises(ValueError): self.hook.poll()

    def test_backoff_skips_work_without_model_wake(self):
        first=self.hook.poll()
        self.hook.release('request-1',first['claim']['work']['runId'],'host_unavailable')
        self.assertFalse(self.hook.poll()['wake'])
        self.server.now+=10001
        self.assertTrue(self.hook.poll()['wake'])


class CliTests(unittest.TestCase):
    def test_hard_deadline_interrupts_a_slow_response_body_and_mutation_busy_is_retryable(self):
        root=Path(__file__).resolve().parents[2]
        sys.path.insert(0,str(root/'scripts'))
        spec=importlib.util.spec_from_file_location('project_hook_cli',root/'scripts/project-inbox-hook.py')
        cli=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cli)
        with tempfile.TemporaryDirectory() as temp:
            directory=Path(temp)
            token=directory/'token'
            token.write_text('jpi_'+'1'*64)
            token.chmod(0o600)
            state=directory/'state'
            state.mkdir(mode=0o700)
            env={'JARVIS_PROJECT_URL':'https://fixture.invalid/relay/projects/jarvis','JARVIS_PROJECT_TOKEN_FILE':str(token),'JARVIS_PROJECT_STATE_DIRECTORY':str(state)}
            class SlowBody:
                def __enter__(self): return self
                def __exit__(self,*_): pass
                def read(self,_):
                    time.sleep(0.2)
                    return b'{}'
            opener=mock.Mock()
            opener.open.return_value=SlowBody()
            real_timer=signal.setitimer
            timer=lambda which,seconds: real_timer(which,0.03 if seconds else 0)
            with mock.patch.dict(os.environ,env), mock.patch.object(sys,'argv',['hook','poll']), mock.patch.object(cli.urllib.request,'build_opener',return_value=opener), mock.patch.object(cli.signal,'setitimer',side_effect=timer):
                with self.assertRaises(cli.RemoteError) as failure: cli.main()
                self.assertEqual(failure.exception.code,'hook_budget_exhausted')
            with (state/'hook.lock').open('a') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                for command,expected in [('poll',0),('renew',75),('complete',75),('consume',75)]:
                    out=io.StringIO()
                    with mock.patch.dict(os.environ,env), mock.patch.object(sys,'argv',['hook',command]), contextlib.redirect_stdout(out):
                        self.assertEqual(cli.main(),expected)
                    self.assertTrue(json.loads(out.getvalue())['busy'])


if __name__ == '__main__':
    unittest.main()
