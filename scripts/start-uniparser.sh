#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source /home/ljy/miniconda3/etc/profile.d/conda.sh
conda activate /home/hk/.conda/envs/dataagent
export UNIPARSER_CACHE="${UNIPARSER_CACHE:-$ROOT/data/models/uniparser}"
export UNIPARSER_REPO="${UNIPARSER_REPO:-UniParser/MolParser-Mobile}"
export UNIPARSER_DEVICE="${UNIPARSER_DEVICE:-cpu}"
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-}"
mkdir -p "$UNIPARSER_CACHE"
echo "Starting UniParser sidecar on 127.0.0.1:8200 (CPU, not wired into MinerU/Agent)"
exec python -m uvicorn app:app --app-dir "$ROOT/services/uniparser" --host 127.0.0.1 --port 8200
