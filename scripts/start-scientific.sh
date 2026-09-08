#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
# shellcheck disable=SC1091
source /home/ljy/miniconda3/etc/profile.d/conda.sh
conda activate /home/hk/.conda/envs/dataagent
export PYTHONPATH="$ROOT/services/scientific:${PYTHONPATH:-}"
export MINERU_MODEL_SOURCE="${MINERU_MODEL_SOURCE:-modelscope}"
exec python -m uvicorn app.main:app --app-dir "$ROOT/services/scientific" --host "${SCIENTIFIC_HOST:-127.0.0.1}" --port "${SCIENTIFIC_PORT:-8100}"
