#!/usr/bin/env bash
# Freeze octopus-kb into a relocatable PyInstaller onedir.
#
# Do not copy a build-machine venv into the .app. The output is:
#   dist/.cache/kb-runtime/octopus-kb-sidecar/octopus-kb-sidecar
#   dist/.cache/kb-runtime/prompts/
#   dist/.cache/kb-runtime/schemas/
#   dist/.cache/kb-runtime/LICENSE
#   dist/.cache/kb-runtime/SOURCE.txt
#
# Usage: bash scripts/build-kb-sidecar.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$REPO_ROOT/packages/experimental/desktop-ask-knowledge"
PYTHON_DIR="$PKG/python"
KB_DIR="$PYTHON_DIR/kb"
CACHE="$REPO_ROOT/dist/.cache/kb-sidecar-build"
OUT="$REPO_ROOT/dist/.cache/kb-runtime"

info() { printf '\033[1;34m▶ %s\033[0m\n' "$1"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[[ -f "$PYTHON_DIR/sidecar.py" ]] || fail "missing $PYTHON_DIR/sidecar.py"
[[ -d "$KB_DIR/src" ]] || fail "missing vendored kb at $KB_DIR"

PYTHON="${ASK_KNOWLEDGE_PYTHON:-python3}"
command -v "$PYTHON" >/dev/null || fail "python3 is required to freeze the sidecar"

mkdir -p "$CACHE" "$OUT"
VENV="$CACHE/venv"
if [[ ! -x "$VENV/bin/python" ]]; then
  info "Creating sidecar build venv..."
  "$PYTHON" -m venv "$VENV"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"
info "Installing freeze dependencies..."
python -m pip install --upgrade pip >/dev/null
python -m pip install -q pyinstaller "markitdown[pdf]>=0.1" openpyxl
python -m pip install -q --force-reinstall --no-deps "$KB_DIR"

info "Freezing octopus-kb-sidecar (onedir)..."
rm -rf "$CACHE/dist" "$CACHE/build"
(
  cd "$PYTHON_DIR"
  pyinstaller \
    --noconfirm \
    --clean \
    --onedir \
    --name octopus-kb-sidecar \
    --distpath "$CACHE/dist" \
    --workpath "$CACHE/build" \
    --specpath "$CACHE" \
    --collect-all octopus_kb_compound \
    --collect-all markitdown \
    --collect-all magika \
    --collect-all pdfminer \
    --collect-all pdfplumber \
    --hidden-import jsonschema \
    --hidden-import pydantic \
    --hidden-import yaml \
    --hidden-import httpx \
    --hidden-import openpyxl \
    --hidden-import pdfminer \
    --hidden-import pdfplumber \
    --add-data "$KB_DIR/src/octopus_kb_compound/validators/builtins.yaml:octopus_kb_compound/validators" \
    sidecar.py
)

[[ -x "$CACHE/dist/octopus-kb-sidecar/octopus-kb-sidecar" ]] \
  || fail "PyInstaller did not emit octopus-kb-sidecar"

rm -rf "$OUT"
mkdir -p "$OUT"
ditto "$CACHE/dist/octopus-kb-sidecar" "$OUT/octopus-kb-sidecar"
ditto "$KB_DIR/prompts" "$OUT/prompts"
ditto "$KB_DIR/schemas" "$OUT/schemas"
cp "$PYTHON_DIR/LICENSE" "$OUT/LICENSE"
cp "$PYTHON_DIR/SOURCE.txt" "$OUT/SOURCE.txt"

ESCAPED="$(find "$OUT" -type l ! -exec test -e {} \; -print)"
if [[ -n "$ESCAPED" ]]; then
  printf '%s\n' "$ESCAPED"
  fail "kb-runtime contains broken symlinks"
fi
OUTSIDE="$(find "$OUT" -type l -lname '/*' -print)"
if [[ -n "$OUTSIDE" ]]; then
  printf '%s\n' "$OUTSIDE"
  fail "kb-runtime contains absolute-path symlinks"
fi

SELFTEST="$(printf '%s\n' '{"command":"self-test"}' | env \
  OCTOPUS_KB_ROOT="$OUT" \
  "$OUT/octopus-kb-sidecar/octopus-kb-sidecar" 2>/dev/null || true)"
if printf '%s' "$SELFTEST" | grep -q '"pdf": true' \
  && printf '%s' "$SELFTEST" | grep -q '"xlsx": true' \
  && printf '%s' "$SELFTEST" | grep -q '"proposalSchema": true' \
  && printf '%s' "$SELFTEST" | grep -q '"applyRules": true' \
  && printf '%s' "$SELFTEST" | grep -q '"rulesSchema": true' \
  && printf '%s' "$SELFTEST" | grep -q '"pageMetaFill": true' \
  && printf '%s' "$SELFTEST" | grep -q '"retrieveFold": true' \
  && printf '%s' "$SELFTEST" | grep -q '"convertFile": true'; then
  ok "Frozen sidecar reports pdf, xlsx, proposal schema, apply rules, rules schema, page-meta fill, retrieve fold, and convert-file"
else
  printf '%s\n' "$SELFTEST"
  fail "frozen sidecar missing pdf/xlsx extras, page-meta fill, retrieve fold, convert-file, or cannot open proposal.json / builtins.yaml / rules/v1.json"
fi

ok "Sidecar runtime at $OUT"
