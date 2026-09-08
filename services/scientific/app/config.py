from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[3] / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    scientific_host: str = "127.0.0.1"
    scientific_port: int = 8100

    storage_root: Path = Path("./data")
    mineru_mode: str = "api"
    mineru_api_url: str = "http://127.0.0.1:8000"
    mineru_output_root: Path = Path("./data/documents")
    mineru_backend: str = "pipeline"
    mineru_model_source: str = "modelscope"
    mineru_max_pages: int = 0
    mineru_chunk_pages: int | None = None
    mineru_chunk_overlap: int | None = None

    atom_mapper: str = "rxnmapper"
    pdf_password: str = ""
    pdf_passwords: str = ""

    @field_validator("mineru_chunk_pages", "mineru_chunk_overlap", mode="before")
    @classmethod
    def empty_int_to_none(cls, value: object) -> object:
        if value == "" or value is None:
            return None
        return value


settings = Settings()
