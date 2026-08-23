#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source /home/ljy/miniconda3/etc/profile.d/conda.sh
conda activate /home/hk/.conda/envs/dataagent
export MINERU_MODEL_SOURCE="${MINERU_MODEL_SOURCE:-modelscope}"
export MINERU_API_OUTPUT_ROOT="${MINERU_API_OUTPUT_ROOT:-./data/mineru-api-output}"
mkdir -p "$MINERU_API_OUTPUT_ROOT"
echo "Starting mineru-api on 127.0.0.1:8000 (pipeline / CPU capable)"
exec mineru-api --host 127.0.0.1 --port 8000
