# Chem PDF Agent

Agent 驱动的化学 PDF 解析与反应抽取平台。

上传一篇化学论文，用本地 [MinerU](https://github.com/opendatalab/MinerU) 做版面解析，在工作台里并排查看 PDF 与结构化结果，再把目标 JSON Schema 交给 Agent 做全页抽取。抽取结果经 RDKit / atom mapper 校验后进入人工审核，可导出 JSON、JSONL 或 RXN。

```text
Browser (React)
    ↓ REST + SSE
TypeScript Agent Server (Fastify + Pi Agent)
    ↓
Python Scientific Service (MinerU adapter + RDKit)
    ↓
SQLite + local files
```

## 功能

- 上传 PDF，按文件内容哈希落盘，重复上传会复用同一文档
- 调用本地 MinerU 做版面解析；大文件自动分页分块
- PDF 与 Markdown / 版面块并排查看，点击 block 可跳转并高亮 bbox
- Agent 按用户给定的 JSON Schema 抽取化学反应
- RDKit 校验结构；atom mapping 只来自专用工具，模型不得编造
- 人工审核、修改后确认，导出 `approved` / `edited` 结果

## 环境要求

- Python 3.11+
- Node.js 20+
- conda 或 venv（推荐独立环境，例如 `dataagent`）
- 一台可访问的 OpenAI 兼容 LLM 接口（用于 Agent 抽取）

MinerU 支持 CPU（`pipeline`）和 GPU。没有 NVIDIA GPU 时请安装 `mineru[pipeline]`，不要装 `mineru[all]`（会拉取 vLLM）。

## 安装与配置

下面按顺序完成本地部署。先把 MinerU 跑起来，再启动本项目的科学服务和前后端。

### 1. 克隆仓库并准备配置

```bash
git clone <your-repo-url> chem-pdf-agent
cd chem-pdf-agent
cp .env.example .env
```

编辑 `.env`，至少填写 LLM：

```env
LLM_BASE_URL=http://127.0.0.1:8001/v1
LLM_API_KEY=your-api-key
LLM_MODEL=your-model-name
```

模型名、地址、密钥一律从 `.env` 读取，不要写进代码。

其余常用项（默认即可先跑通）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MINERU_API_URL` | `http://127.0.0.1:8000` | 本地 MinerU API |
| `MINERU_BACKEND` | `pipeline` | CPU 用 `pipeline`；有 GPU 可按 MinerU 文档切换 |
| `MINERU_MODEL_SOURCE` | `modelscope` | 模型下载源 |
| `MINERU_MAX_PAGES` | `0` | `0` 表示按自适应分块解析全文；`>0` 则限制页数 |
| `STORAGE_ROOT` | `./data` | 本地数据根目录 |
| `DATABASE_URL` | `sqlite:///./data/app.db` | 默认 SQLite |

### 2. 本地部署 MinerU

创建并激活 Python 环境：

```bash
conda create -n dataagent python=3.11 -y
conda activate dataagent
python -m pip install -U pip
```

安装 MinerU（CPU / pipeline）：

```bash
python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
python -m pip install "mineru[pipeline]"
```

有可用 NVIDIA GPU 时，按 [MinerU 官方文档](https://github.com/opendatalab/MinerU) 安装对应后端，并把 `.env` 中的 `MINERU_BACKEND` 改成实际后端名。

下载 pipeline 模型（推荐 ModelScope）：

```bash
export MINERU_MODEL_SOURCE=modelscope
mineru-models-download --model_type pipeline
```

模型会下载到本机缓存（例如 `~/.cache/modelscope/`），不会进入本仓库。

启动 MinerU API（独立进程，默认 `127.0.0.1:8000`）：

```bash
export MINERU_MODEL_SOURCE=modelscope
export MINERU_API_OUTPUT_ROOT=./data/mineru-api-output
mkdir -p "$MINERU_API_OUTPUT_ROOT"
mineru-api --host 127.0.0.1 --port 8000
```

打开 http://127.0.0.1:8000/docs 确认服务已就绪。

仓库里的 `scripts/start-mineru.sh` 是本机快捷脚本，里面写死了开发环境的 conda 路径。换机器部署时请先 `conda activate dataagent`，再按上面的命令启动，或按自己的环境改脚本。

MinerU 暂时没起来时，科学服务会回退到 PyMuPDF，工作台仍可打开，但版面解析质量会下降。

### 3. 安装科学服务依赖

仍在同一个 Python 环境中：

```bash
conda activate dataagent
python -m pip install -r services/scientific/requirements.txt
# 可选：反应原子映射
python -m pip install rxnmapper
```

`mineru[pipeline]` 已在上一步安装，这里不再重复。

### 4. 安装 Node 依赖并启动应用

新开终端：

```bash
cd chem-pdf-agent
npm install
```

分别启动科学服务、Agent 服务、前端（三个终端，且科学服务所在终端已 `conda activate dataagent`）：

```bash
# 终端 A：科学服务 :8100
export PYTHONPATH="$PWD/services/scientific:${PYTHONPATH:-}"
python -m uvicorn app.main:app --app-dir services/scientific --host 127.0.0.1 --port 8100

# 终端 B：Agent 服务 :3001
npm run dev --workspace=apps/server

# 终端 C：前端 :5173
npm run dev --workspace=apps/web
```

或在已激活正确 conda 环境后使用：

```bash
bash scripts/dev.sh
```

浏览器打开：

```text
http://127.0.0.1:5173
```

启动顺序建议：MinerU → 科学服务 → Agent 服务 → 前端。

### 5. 生成示例 PDF（可选）

```bash
conda activate dataagent
python scripts/generate_demo_pdf.py
```

会生成 `samples/esterification_demo.pdf`，可在首页上传做端到端验证。该文件默认不纳入 git。

## 使用

1. 打开首页，上传一篇化学 PDF（可用上一步生成的样例）。
2. 进入文档页，点击「开始解析」。大文件会自动分块；右侧出现 Markdown / 版面块后即解析完成。
3. 点击一个 block，中间 PDF 跳转到对应页并高亮 bbox。
4. 打开 Agent，确认默认 JSON Schema，输入例如：

   > 请按照上述 JSON 格式抽取当前 PDF 中所有报告的化学反应。

5. 进度以 SSE 时间线显示。点击一条 reaction 可跳到证据页。
6. 需要改字段时直接编辑，再确认。
7. 导出 JSON / JSONL / RXN。默认只包含 `approved` 与 `edited`。

## 数据落盘位置

上传与解析都写在本地 `data/`，**不要提交到 git**：

```text
data/app.db                          SQLite
data/documents/<sha256>/original.pdf 上传的 PDF
data/documents/<sha256>/mineru/      MinerU 解析结果
data/documents/<sha256>/chunks/      大文件分页块
data/documents/<sha256>/pages/       渲染页图
data/mineru-api-output/              MinerU API 过程输出
data/review/                         审核导出
```

`<sha256>` 是文件内容哈希，不是上传时的文件名。同一文件再次上传会复用已有目录。

## 抽取约定

PDF 中没有写明的字段必须是 `null`，不要填 `0`、`"unknown"`，也不要用化学常识补全。

内部 provenance 取值：

```text
source_not_present
unreadable
not_applicable
extraction_failed
pending_review
redacted_or_restricted
```

`atom_mapped_reaction_smiles` 只能来自 `atom_map_reaction` 工具。未安装 mapper 时该字段为 `null`，`missing_reason = extraction_failed`。

## 目录结构

```text
apps/web              前端（Vite + React）
apps/server           Fastify + Pi Agent + SQLite
services/scientific   MinerU 适配、PDF 处理、RDKit / RXN
data/                 运行时数据（已 gitignore）
samples/              示例 PDF 生成目录
scripts/              启动与样例脚本
docker-compose.yml    web / server / scientific
```

## Docker（可选）

本仓库提供科学服务、Agent 服务和前端的 Compose 配置，**不包含** MinerU GPU 镜像（体积过大）。请先在本机或 GPU 机器单独启动 MinerU，再设置 `MINERU_API_URL`：

```bash
docker compose up --build
```

