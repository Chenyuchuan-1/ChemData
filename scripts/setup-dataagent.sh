#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source /home/ljy/miniconda3/etc/profile.d/conda.sh
conda activate /home/hk/.conda/envs/dataagent
python -m pip install -U pip uv setuptools wheel
python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
python -m pip install fastapi "uvicorn[standard]" pydantic pydantic-settings httpx python-multipart pymupdf pillow rdkit python-dotenv
python -m pip install -U "mineru[pipeline]"
export MINERU_MODEL_SOURCE=modelscope
echo "dataagent ready. Next: mineru-models-download --model_type pipeline"
echo "Then: bash scripts/start-mineru.sh"
