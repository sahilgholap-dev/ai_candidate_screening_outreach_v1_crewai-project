#!/usr/bin/env python
"""CLI entry points.

The screening pipeline itself lives in pipeline/runner.py and is executed by
the queue worker (pipeline/queue_worker.py) behind the FastAPI app. These
commands exist for local debugging.
"""

import sys

from ai_candidate_screening_outreach.pipeline.queue_worker import (
    requeue_stuck_campaigns,
    start_worker,
)
from ai_candidate_screening_outreach.pipeline.runner import run_campaign


def run():
    """Run the pipeline for one campaign id: main.py run <campaign_id>"""
    if len(sys.argv) < 3:
        print("Usage: main.py run <campaign_id>")
        sys.exit(1)
    run_campaign(int(sys.argv[2]))


def worker():
    """Run the queue worker in the foreground (standalone, without the API)."""
    import time

    requeued = requeue_stuck_campaigns()
    if requeued:
        print(f"[queue] re-queued {requeued} stuck campaign(s)")
    start_worker()
    while True:
        time.sleep(60)


def train():
    raise SystemExit("Training is not wired for the multi-crew pipeline yet.")


def replay():
    raise SystemExit("Replay is not wired for the multi-crew pipeline yet.")


def test():
    raise SystemExit("Use the API + queue worker to exercise the pipeline.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: main.py <run|worker> [<args>]")
        sys.exit(1)

    command = sys.argv[1]
    if command == "run":
        run()
    elif command == "worker":
        worker()
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)
