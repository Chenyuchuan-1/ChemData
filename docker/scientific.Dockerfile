FROM python:3.11-slim

WORKDIR /app
COPY services/scientific /app
RUN pip install --no-cache-dir fastapi "uvicorn[standard]" pydantic pydantic-settings httpx python-multipart pymupdf pillow rdkit python-dotenv

EXPOSE 8100
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
