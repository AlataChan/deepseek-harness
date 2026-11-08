#!/usr/bin/env python3
"""Exercise pinned run_cmd through a real nested helper and yt-dlp descendant."""
import argparse
import json
import os
import subprocess
import sys
from agent_reach.runtime.run import run_cmd


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ytdlp', required=True)
    parser.add_argument('--url', required=True)
    parser.add_argument('--ready-file', required=True)
    parser.add_argument('--timeout', type=float, default=30.0)
    parser.add_argument('--backend-child', action='store_true')
    args = parser.parse_args()
    if args.backend_child:
        # The descendant must not retain run_cmd's pipes after the helper is killed.
        child = subprocess.Popen([args.ytdlp, '--ignore-config', args.url],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL)
        try:
            temporary = args.ready_file + '.tmp'
            with open(temporary, 'x', encoding='utf-8') as stream:
                json.dump({'pid': child.pid, 'helper': os.getpid()}, stream)
            os.replace(temporary, args.ready_file)
            return child.wait()
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait()
    try:
        run_cmd([sys.executable, __file__, '--backend-child', '--ytdlp', args.ytdlp,
                 '--url', args.url, '--ready-file', args.ready_file], timeout=args.timeout)
    except Exception as error:
        sys.stderr.write(f'run_cmd ended with: {error}\n')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
