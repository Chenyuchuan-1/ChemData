#!/usr/bin/env bash
# Detached zcy resume. Run in a machine-local terminal (not Cursor).
# If Agent is already healthy, this only prints status and does not start a second job.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
LOG_DIR="$ROOT/data/logs"
mkdir -p "$LOG_DIR"

# shellcheck disable=SC1091
source /home/ljy/miniconda3/etc/profile.d/conda.sh
conda activate /home/hk/.conda/envs/dataagent

export MINERU_MODEL_SOURCE="${MINERU_MODEL_SOURCE:-modelscope}"
export MINERU_API_OUTPUT_ROOT="${MINERU_API_OUTPUT_ROOT:-$ROOT/data/mineru-api-output}"
export PYTHONPATH="$ROOT/services/scientific:${PYTHONPATH:-}"
export UNIPARSER_CACHE="${UNIPARSER_CACHE:-$ROOT/data/models/uniparser}"
export UNIPARSER_REPO="${UNIPARSER_REPO:-UniParser/MolParser-Mobile}"
export UNIPARSER_DEVICE="${UNIPARSER_DEVICE:-cpu}"
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-}"
mkdir -p "$MINERU_API_OUTPUT_ROOT"

port_up() {
  curl -sf -m 2 "$1" >/dev/null
}

start_if_down() {
  local name="$1" health="$2" logfile="$3"
  shift 3
  if port_up "$health"; then
    echo "[skip] $name already listening"
    return 0
  fi
  echo "[start] $name -> $logfile"
  nohup "$@" >>"$logfile" 2>&1 &
  echo $! >"$LOG_DIR/${name}.pid"
}

AGENT_WAS_UP=0
if port_up "http://127.0.0.1:3001/api/health"; then
  AGENT_WAS_UP=1
fi

start_if_down mineru "http://127.0.0.1:8000/health" "$LOG_DIR/mineru.nohup.log" \
  mineru-api --host 127.0.0.1 --port 8000

start_if_down scientific "http://127.0.0.1:8100/health" "$LOG_DIR/scientific.nohup.log" \
  python -m uvicorn app.main:app --app-dir "$ROOT/services/scientific" --host 127.0.0.1 --port 8100

start_if_down uniparser "http://127.0.0.1:8200/health" "$LOG_DIR/uniparser.nohup.log" \
  python -m uvicorn app:app --app-dir "$ROOT/services/uniparser" --host 127.0.0.1 --port 8200

if [[ "$AGENT_WAS_UP" -eq 1 ]]; then
  echo "[skip] agent already listening"
else
  echo "[start] agent -> $LOG_DIR/agent.nohup.log"
  nohup npm start --workspace=apps/server >>"$LOG_DIR/agent.nohup.log" 2>&1 &
  echo $! >"$LOG_DIR/agent.pid"
fi

echo "waiting for health..."
for i in $(seq 1 60); do
  if port_up "http://127.0.0.1:8000/health" \
    && port_up "http://127.0.0.1:8100/health" \
    && port_up "http://127.0.0.1:3001/api/health"; then
    echo "stack is up"
    break
  fi
  sleep 2
  if [[ "$i" -eq 60 ]]; then
    echo "health timeout; check $LOG_DIR/*.nohup.log" >&2
    exit 1
  fi
done

if [[ "$AGENT_WAS_UP" -eq 1 ]]; then
  echo "[skip] Agent 仍在运行，不重复提交 parse/batch"
else
  echo "[resume] cancel stale in-memory batch rows, then continue unfinished docs"
  python3 - <<'PY'
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
import json

con = sqlite3.connect("/home/hk/cyc/chemflow/data/app.db")
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
con.execute(
    "UPDATE batch_jobs SET status=?, error=?, updated_at=? WHERE status='running'",
    ("cancelled", "stale_after_disconnect_resume", now),
)
con.commit()
root = Path("/home/hk/cyc/chemflow/data/documents")
ids = []
for row in con.execute("select id, parse_status from documents"):
    doc_id, status = row
    if status == "parsing":
        ids.append(doc_id)
        continue
    manifest = root / doc_id / "mineru" / "chunk_manifest.json"
    if not manifest.exists():
        if status != "completed":
            ids.append(doc_id)
        continue
    data = json.loads(manifest.read_text())
    if any(c.get("status") != "completed" for c in data.get("chunks", [])):
        ids.append(doc_id)
con.close()
Path("/tmp/chemflow-resume-docs.txt").write_text("\n".join(ids) + ("\n" if ids else ""))
print("\n".join(ids))
PY

  if [[ -s /tmp/chemflow-resume-docs.txt ]]; then
    while read -r doc_id; do
      [[ -z "$doc_id" ]] && continue
      echo "[resume] parse $doc_id (skips completed chunks)"
      curl -sS -m 30 -X POST "http://127.0.0.1:3001/api/documents/${doc_id}/parse" \
        -H "Content-Type: application/json" \
        -d '{"full":true}'
      echo
    done < /tmp/chemflow-resume-docs.txt
  fi

  echo "[resume] start zcy batch (completed parse+extract books are skipped)"
  curl -sS -m 20 -X POST http://127.0.0.1:3001/api/batch/zcy \
    -H "Content-Type: application/json" \
    -d '{}'
  echo
fi

echo
echo "status:"
python3 - <<'PY'
import sqlite3, json, urllib.request
con = sqlite3.connect("/home/hk/cyc/chemflow/data/app.db")
print("docs:")
for r in con.execute("select filename, parse_status, parse_error from documents"):
    print(" -", r[0], r[1], r[2])
print("batch:")
for r in con.execute("select id, status, summary_json, error from batch_jobs order by rowid desc limit 2"):
    summary = (r[2] or "")[:180]
    print(" -", r[0], r[1], r[3], summary)
job = con.execute("select id from batch_jobs order by rowid desc limit 1").fetchone()
con.close()
if job:
    print("watch: curl -sS http://127.0.0.1:3001/api/batch/" + job[0])
PY
echo "logs: $LOG_DIR"
