#!/usr/bin/env python3
"""Local adapter entry point; configure only after action-time approval."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from lib.project_hook import Hook, RemoteError


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['poll', 'complete', 'renew', 'release', 'consume', 'replay'])
    parser.add_argument('--event-ids-file')
    parser.add_argument('--message-id')
    parser.add_argument('--run-id')
    parser.add_argument('--body-file')
    parser.add_argument('--summary-file')
    parser.add_argument('--reason', choices=['host_unavailable', 'timeout', 'execution_interrupted'])
    args = parser.parse_args()
    base = os.environ['JARVIS_PROJECT_URL'].rstrip('/')
    url = urllib.parse.urlsplit(base)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.port not in (None, 443) or not re.fullmatch(r'/relay/projects/[a-z][a-z0-9-]{0,63}', url.path):
        raise ValueError('invalid_project_url')
    token_path = Path(os.environ['JARVIS_PROJECT_TOKEN_FILE'])
    if stat.S_IMODE(token_path.stat().st_mode) & 0o077:
        raise ValueError('token_file_must_be_private')
    token = token_path.read_text().strip()
    if not re.fullmatch(r'jpi_[a-f0-9]{64}', token):
        raise ValueError('invalid_project_token')
    directory = Path(os.environ['JARVIS_PROJECT_STATE_DIRECTORY'])
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if stat.S_IMODE(directory.stat().st_mode) & 0o077:
        raise ValueError('state_directory_must_be_private')
    os.umask(0o077)
    # The lock covers journal and HTTP steps across independent Bash invocations.
    with (directory / 'hook.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'schema':'jarvis-project-hook-v1', 'wake':False, 'busy':True}))
            return 0 if args.command == 'poll' else 75
        deadline = time.monotonic() + 45
        def budget_exhausted(_signum, _frame):
            raise RemoteError(503, 'hook_budget_exhausted')
        previous_alarm = signal.signal(signal.SIGALRM, budget_exhausted)
        signal.setitimer(signal.ITIMER_REAL, 45)
        opener = urllib.request.build_opener(NoRedirect())

        def request(op, payload):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RemoteError(503, 'hook_budget_exhausted')
            read = op in ('identity', 'events', 'work', 'message')
            endpoint = base + '/' + op + ('?' + urllib.parse.urlencode(payload) if read and payload else '')
            headers = {'Authorization':'Bearer ' + token, 'Accept':'application/json'}
            data = None if read else json.dumps(payload, ensure_ascii=False).encode()
            if data is not None:
                headers['Content-Type'] = 'application/json'
            try:
                with opener.open(urllib.request.Request(endpoint, data=data, headers=headers), timeout=min(20, remaining)) as response:
                    raw = response.read(500001)
                    if len(raw) > 500000:
                        raise ValueError('oversized_server_response')
                    return json.loads(raw)
            except urllib.error.HTTPError as error:
                # Server bodies, URLs, request text and credentials stay out of logs.
                raise RemoteError(error.code, 'http_' + str(error.code)) from None

        hook = Hook(directory / 'journal.sqlite', request)
        try:
            if args.command == 'poll':
                result = hook.poll()
            elif args.command == 'replay':
                result = hook.replay()
            elif args.command == 'consume':
                if not args.event_ids_file:
                    raise ValueError('notification_ids_required')
                result = hook.consume(json.loads(Path(args.event_ids_file).read_text()))
            else:
                if not args.message_id or not args.run_id:
                    raise ValueError('message_and_run_required')
                if args.command == 'complete':
                    if not args.body_file or not args.summary_file:
                        raise ValueError('completion_files_required')
                    result = hook.complete(args.message_id, args.run_id, Path(args.body_file).read_text(), Path(args.summary_file).read_text())
                elif args.command == 'renew':
                    result = hook.renew(args.message_id, args.run_id)
                else:
                    if not args.reason:
                        raise ValueError('retry_reason_required')
                    result = hook.release(args.message_id, args.run_id, args.reason)
            print(json.dumps(result, separators=(',', ':')))
            return 0
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous_alarm)
            hook.close()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except RemoteError as error:
        print(json.dumps({'schema':'jarvis-project-hook-v1', 'wake':False, 'error':error.code}), file=sys.stderr)
        sys.exit(2 if error.status in (401, 403) else 1)
    except Exception:
        print(json.dumps({'schema':'jarvis-project-hook-v1', 'wake':False, 'error':'hook_unavailable'}), file=sys.stderr)
        sys.exit(1)
