"""Document conversion, PDF inspection, and normalization for Ask Knowledge.

Provides format-specific conversion, PDF structure analysis (extractable text vs. scans),
block generation with locators, and honest status classification (complete, partial,
needs_ocr, unsupported, failed).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
import unicodedata

try:
    import pypdf
except ImportError:
    pypdf = None


def normalize_text(text: str) -> str:
    """Normalize Unicode characters (NFKC) preserving Chinese radicals."""
    return unicodedata.normalize("NFKC", text)


def inspect_pdf(pdf_path: Path) -> dict[str, Any]:
    """Inspect PDF pages to distinguish extractable text, mixed pages, and scans.

    Never invokes cloud OCR or external network APIs.
    """
    if pypdf is None:
        return {
            "status": "failed",
            "error": "pypdf library is not available in the Python runtime",
            "blocks": [],
            "markdown": "",
            "diagnostics": {"warnings": ["pypdf unavailable"], "omissions": []},
        }

    try:
        reader = pypdf.PdfReader(str(pdf_path))
    except Exception as exc:
        return {
            "status": "failed",
            "error": f"Failed to read PDF: {exc}",
            "blocks": [],
            "markdown": "",
            "diagnostics": {"warnings": [str(exc)], "omissions": []},
        }

    total_pages = len(reader.pages)
    if total_pages == 0:
        return {
            "status": "unsupported",
            "error": "PDF has 0 pages",
            "blocks": [],
            "markdown": "",
            "diagnostics": {"warnings": ["empty PDF"], "omissions": []},
        }

    pages_info: list[dict[str, Any]] = []
    text_pages_count = 0
    image_only_pages: list[int] = []
    all_blocks: list[dict[str, Any]] = []
    markdown_parts: list[str] = []
    warnings: list[str] = []
    omissions: list[str] = []

    char_offset = 0

    for idx, page in enumerate(reader.pages, start=1):
        try:
            raw_text = page.extract_text() or ""
        except Exception as exc:
            raw_text = ""
            warnings.append(f"page {idx}: text extraction failed: {exc}")

        norm_text = normalize_text(raw_text).strip()
        try:
            image_count = len(page.images)
        except Exception:
            image_count = 0

        has_text = len(norm_text) > 0
        is_cover_only = False

        if has_text and image_count > 0:
            is_cover_only = True

        if has_text:
            text_pages_count += 1
            if is_cover_only:
                warnings.append(f"page {idx}: contains images whose text completeness is unverified; OCR may be needed")
                omissions.append(f"page {idx} body image")
        elif image_count > 0:
            image_only_pages.append(idx)
            warnings.append(f"page {idx} of {total_pages} needs OCR")
            omissions.append(f"page {idx}")
        else:
            omissions.append(f"page {idx} (blank)")

        pages_info.append({
            "page": idx,
            "hasText": has_text,
            "textLength": len(norm_text),
            "imageCount": image_count,
            "isCoverOnly": is_cover_only,
        })

        if has_text:
            paragraphs = [p.strip() for p in norm_text.split("\n\n") if p.strip()]
            for p_idx, para in enumerate(paragraphs):
                lines = para.split("\n")
                kind = "heading" if (lines[0].startswith("#") or (len(lines) == 1 and len(para) < 40 and not para.endswith("。"))) else "paragraph"
                block_id = f"p{idx}_b{p_idx + 1}"
                block = {
                    "id": block_id,
                    "kind": kind,
                    "text": para,
                    "page": idx,
                    "locator": {"page": idx, "blockIndex": p_idx + 1},
                    "charOffset": char_offset,
                }
                all_blocks.append(block)
                char_offset += len(para) + 2

            page_header = f"<!-- page {idx} -->\n" if total_pages > 1 else ""
            markdown_parts.append(page_header + norm_text)

    # Determine status
    if text_pages_count == total_pages and not any(p["isCoverOnly"] for p in pages_info):
        status = "complete"
    elif text_pages_count > 0 and (len(image_only_pages) > 0 or any(p["isCoverOnly"] for p in pages_info)):
        status = "partial"
    elif text_pages_count == 0 and len(image_only_pages) > 0:
        status = "needs_ocr"
    elif text_pages_count == 0:
        status = "unsupported"
    else:
        status = "partial"

    full_markdown = "\n\n".join(markdown_parts)

    return {
        "status": status,
        "totalPages": total_pages,
        "textPages": text_pages_count,
        "needsOcrPages": image_only_pages,
        "pages": pages_info,
        "blocks": all_blocks,
        "markdown": full_markdown,
        "diagnostics": {
            "warnings": warnings,
            "omissions": omissions,
            "unsupportedFeatures": ["cloud OCR disabled"] if status in {"partial", "needs_ocr"} else [],
            "needsOcrPages": image_only_pages,
            "totalPages": total_pages,
        },
    }


def convert_file(file_path: str | Path, max_output_bytes: int = 50 * 1024 * 1024) -> dict[str, Any]:
    """Convert a file to normalized markdown, blocks, and diagnostics.

    Enforces file size limit, path existence, and format policies.
    """
    path = Path(file_path).resolve()
    if not path.is_file():
        return {
            "status": "failed",
            "error": f"File does not exist: {path}",
            "blocks": [],
            "markdown": "",
            "diagnostics": {"warnings": ["file not found"], "omissions": []},
        }

    ext = path.suffix.lower()

    # Unsupported legacy Office and OpenDocument formats
    unsupported_formats = {".doc", ".ppt", ".xls", ".odt", ".ods", ".odp"}
    if ext in unsupported_formats:
        return {
            "status": "unsupported",
            "error": f"Legacy format '{ext}' is not supported. Please convert to modern OpenXML (.docx, .pptx, .xlsx) or PDF first.",
            "blocks": [],
            "markdown": "",
            "diagnostics": {
                "warnings": [f"format {ext} is unsupported"],
                "omissions": ["entire document"],
                "unsupportedFeatures": [f"legacy format {ext}"],
            },
        }

    if ext == ".pdf":
        return inspect_pdf(path)

    if ext in {".md", ".txt"}:
        try:
            raw = path.read_bytes()
            if len(raw) > max_output_bytes:
                return {
                    "status": "failed",
                    "error": f"File size {len(raw)} exceeds maximum allowed {max_output_bytes} bytes",
                    "blocks": [],
                    "markdown": "",
                    "diagnostics": {"warnings": ["file size exceeded"], "omissions": []},
                }
            try:
                text = raw.decode("utf-8")
                decoding = "utf-8"
            except UnicodeDecodeError:
                try:
                    text = raw.decode("utf-16")
                    decoding = "utf-16"
                except UnicodeDecodeError:
                    text = raw.decode("utf-8", errors="replace")
                    decoding = "utf-8-replacement"

            norm = normalize_text(text)
            paragraphs = [p.strip() for p in norm.split("\n\n") if p.strip()]
            blocks = []
            offset = 0
            for idx, p in enumerate(paragraphs, start=1):
                kind = "heading" if p.startswith("#") else "paragraph"
                blocks.append({
                    "id": f"b{idx}",
                    "kind": kind,
                    "text": p,
                    "locator": {"blockIndex": idx},
                    "charOffset": offset,
                })
                offset += len(p) + 2

            return {
                "status": "complete",
                "blocks": blocks,
                "markdown": norm,
                "diagnostics": {
                    "warnings": [] if decoding != "utf-8-replacement" else ["decoded with replacement characters"],
                    "omissions": [],
                    "decoding": decoding,
                },
            }
        except Exception as exc:
            return {
                "status": "failed",
                "error": str(exc),
                "blocks": [],
                "markdown": "",
                "diagnostics": {"warnings": [str(exc)], "omissions": []},
            }

    if ext == ".json":
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
            parsed = json.loads(text)
            norm = json.dumps(parsed, ensure_ascii=False, indent=2)
            block = {
                "id": "b1",
                "kind": "code",
                "text": f"```json\n{norm}\n```",
                "locator": {"blockIndex": 1},
                "charOffset": 0,
            }
            return {
                "status": "complete",
                "blocks": [block],
                "markdown": block["text"],
                "diagnostics": {"warnings": [], "omissions": []},
            }
        except Exception as exc:
            return {
                "status": "failed",
                "error": f"Invalid JSON: {exc}",
                "blocks": [],
                "markdown": "",
                "diagnostics": {"warnings": [str(exc)], "omissions": []},
            }

    if ext == ".csv":
        try:
            import csv
            text = path.read_text(encoding="utf-8", errors="replace")
            reader = csv.reader(text.splitlines())
            rows = list(reader)
            if not rows:
                return {
                    "status": "failed",
                    "error": "CSV file is empty",
                    "blocks": [],
                    "markdown": "",
                    "diagnostics": {"warnings": ["empty file"], "omissions": []},
                }
            md_lines = []
            header = rows[0]
            md_lines.append("| " + " | ".join(header) + " |")
            md_lines.append("| " + " | ".join(["---"] * len(header)) + " |")
            blocks = []
            offset = 0
            for r_idx, row in enumerate(rows[1:], start=1):
                padded = row + [""] * max(0, len(header) - len(row))
                line = "| " + " | ".join(padded[:len(header)]) + " |"
                md_lines.append(line)
                blocks.append({
                    "id": f"row_{r_idx}",
                    "kind": "table",
                    "text": line,
                    "locator": {"row": r_idx},
                    "charOffset": offset,
                })
                offset += len(line) + 1

            full_md = "\n".join(md_lines)
            return {
                "status": "complete",
                "blocks": blocks,
                "markdown": full_md,
                "diagnostics": {"warnings": [], "omissions": []},
            }
        except Exception as exc:
            return {
                "status": "failed",
                "error": f"CSV parse error: {exc}",
                "blocks": [],
                "markdown": "",
                "diagnostics": {"warnings": [str(exc)], "omissions": []},
            }

    if ext == ".xlsx":
        try:
            import openpyxl
            wb = openpyxl.load_workbook(str(path), data_only=True)
            blocks = []
            md_parts = []
            offset = 0
            warnings = []

            for sheet_name in wb.sheetnames:
                sheet = wb[sheet_name]
                rows = list(sheet.iter_rows(values_only=True))
                if not rows:
                    continue
                md_parts.append(f"## {sheet_name}\n")
                first = [str(c or "") for c in rows[0]]
                md_parts.append("| " + " | ".join(first) + " |")
                md_parts.append("| " + " | ".join(["---"] * len(first)) + " |")
                for r_idx, row in enumerate(rows[1:], start=2):
                    row_vals = [str(c or "") for c in row]
                    # Check for uncalculated formula indication
                    if any(c is None for c in row):
                        warnings.append(f"sheet '{sheet_name}' row {r_idx}: possible empty or uncached formula cell")
                    padded = row_vals + [""] * max(0, len(first) - len(row_vals))
                    line = "| " + " | ".join(padded[:len(first)]) + " |"
                    md_parts.append(line)
                    blocks.append({
                        "id": f"{sheet_name}_r{r_idx}",
                        "kind": "table",
                        "text": line,
                        "locator": {"sheet": sheet_name, "row": r_idx},
                        "charOffset": offset,
                    })
                    offset += len(line) + 1
                md_parts.append("")

            return {
                "status": "complete",
                "blocks": blocks,
                "markdown": "\n".join(md_parts),
                "diagnostics": {"warnings": list(set(warnings)), "omissions": []},
            }
        except Exception as exc:
            return {
                "status": "failed",
                "error": f"Excel parse error: {exc}",
                "blocks": [],
                "markdown": "",
                "diagnostics": {"warnings": [str(exc)], "omissions": []},
            }

    return {
        "status": "unsupported",
        "error": f"Unsupported file extension: {ext}",
        "blocks": [],
        "markdown": "",
        "diagnostics": {"warnings": [f"unsupported extension {ext}"], "omissions": []},
    }
