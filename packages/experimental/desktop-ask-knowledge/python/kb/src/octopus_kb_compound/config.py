from __future__ import annotations

import os
import tomllib
from pathlib import Path

from pydantic import BaseModel


DEFAULT_BASE_URL = "http://localhost:11434/v1"
DEFAULT_MODEL = "qwen2.5:7b-instruct"


class ConfigError(Exception):
    """Raised when `.octopus-kb/config.toml` is invalid."""


class Profile(BaseModel):
    base_url: str
    model: str
    api_key: str | None = None
    timeout: int = 60
    max_retries: int = 2

    def as_client_kwargs(self) -> dict:
        return {
            "base_url": self.base_url,
            "api_key": self.api_key,
            "default_model": self.model,
            "timeout": self.timeout,
            "max_retries": self.max_retries,
        }


class _ProfileConfig(BaseModel):
    base_url: str
    model: str
    api_key_env: str | None = None
    timeout: int = 60
    max_retries: int = 2


class Config:
    def __init__(self, default_profile: str, profiles: dict[str, _ProfileConfig]) -> None:
        self.default_profile = default_profile
        self.profiles = profiles

    def resolve_profile(self, name: str | None = None) -> Profile:
        profile_name = name or self.default_profile
        raw = self.profiles.get(profile_name)
        if raw is None:
            raise ConfigError(f"Unknown LLM profile: {profile_name}")
        api_key = os.environ.get(raw.api_key_env, "") if raw.api_key_env else ""
        return Profile(
            base_url=raw.base_url,
            model=raw.model,
            api_key=api_key or None,
            timeout=raw.timeout,
            max_retries=raw.max_retries,
        )


def load_config(vault_root: str | Path) -> Config:
    root = Path(vault_root)
    path = _find_config_path(root)
    if path is None:
        return Config(
            default_profile="default",
            profiles={
                "default": _ProfileConfig(
                    base_url=DEFAULT_BASE_URL,
                    model=DEFAULT_MODEL,
                )
            },
        )

    data = tomllib.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != 1:
        raise ConfigError(f"Unsupported config version in {path}: {data.get('version')!r}")

    llm = data.get("llm") or {}
    profiles_raw = llm.get("profiles") or {}
    profiles = {
        name: _ProfileConfig.model_validate(value)
        for name, value in profiles_raw.items()
    }
    default_profile = str(llm.get("default_profile") or "default")
    if not profiles:
        profiles = {
            "default": _ProfileConfig(base_url=DEFAULT_BASE_URL, model=DEFAULT_MODEL)
        }
        default_profile = "default"
    if default_profile not in profiles:
        raise ConfigError(f"Default LLM profile not found: {default_profile}")
    return Config(default_profile=default_profile, profiles=profiles)


def _find_config_path(root: Path) -> Path | None:
    for candidate in (
        root / ".octopus-kb" / "config.toml",
        root / "config.toml",
    ):
        if candidate.exists():
            return candidate
    env_path = os.environ.get("OCTOPUS_KB_CONFIG")
    if env_path:
        path = Path(env_path)
        if not path.exists():
            raise ConfigError(f"OCTOPUS_KB_CONFIG does not exist: {path}")
        return path
    return None
