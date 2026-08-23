#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Fill in LLM_BASE_URL / LLM_API_KEY / LLM_MODEL."
fi

# shellcheck disable=SC1091
source /home/ljy/miniconda3/etc/profile.d/conda.sh
conda activate /home/hk/.conda/envs/dataagent

export MINERU_MODEL_SOURCE="${MINERU_MODEL_SOURCE:-modelscope}"
export PYTHONPATH="$ROOT/services/scientific:${PYTHONPATH:-}"

echo "Scientific service :8100"
echo "Agent server       :3001"
echo "Frontend           :5173"
echo "MinerU API         :8000 (start separately with scripts/start-mineru.sh)"

python -m uvicorn app.main:app --app-dir "$ROOT/services/scientific" --host 127.0.0.1 --port 8100 &
SCI_PID=$!
npm run dev --workspace=apps/server &
SRV_PID=$!
npm run dev --workspace=apps/web &
WEB_PID=$!

trap 'kill $SCI_PID $SRV_PID $WEB_PID 2>/dev/null || true' INT TERM
wait
