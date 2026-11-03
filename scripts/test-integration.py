"""Run API regressions against an isolated, disposable local D1 server."""
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
with socket.socket() as probe:
    probe.bind(('127.0.0.1', 5173))  # Never test against an unrelated running server.

with tempfile.TemporaryDirectory(prefix='star-classroom-test-') as temp:
    state = str(Path(temp) / 'state')
    env = {**os.environ, 'CLASSROOM_PREVIEW_STATE': state,
           'CLOUDFLARE_CF_FETCH_ENABLED': 'false', 'WRANGLER_SEND_METRICS': 'false'}
    subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'DB', '--local',
                    '--config', 'wrangler.local.json', '--persist-to', state,
                    '--file', 'drizzle/0000_little_patriot.sql'],
                   cwd=ROOT, env=env, check=True, timeout=90)
    with open(Path(temp) / 'server.log', 'w+') as log:
        server = subprocess.Popen(['npm', 'run', 'dev', '--', '--hostname', '127.0.0.1'],
                                  cwd=ROOT, env=env, stdout=log, stderr=log,
                                  start_new_session=True)
        try:
            deadline = time.monotonic() + 120
            while True:
                if server.poll() is not None:
                    raise RuntimeError('Preview server exited before becoming ready')
                try:
                    with urllib.request.urlopen('http://127.0.0.1:5173/', timeout=3):
                        break
                except (OSError, urllib.error.URLError):
                    if time.monotonic() >= deadline:
                        raise TimeoutError('Preview server did not become ready')
                    time.sleep(1)
            # blackboard_api runs file and classroom regressions first.
            subprocess.run(['python3', 'tests/blackboard_api.py'], cwd=ROOT, env=env,
                           check=True, timeout=120)
        except BaseException:
            log.flush()
            log.seek(0)
            print(log.read())
            raise
        finally:
            try:
                os.killpg(server.pid, signal.SIGTERM)
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(server.pid, signal.SIGKILL)
                server.wait()
            except ProcessLookupError:
                pass
