#!/usr/bin/env python3
"""Self-contained synthetic document fixture generator and validator.

Does not require external packages (e.g. reportlab, python-pptx, anydoc).
Generates long documents (>35k characters), distractor documents, short Chinese
term fixtures, expected facts manifests, and baseline characterization reports.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
import zipfile

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "document-coverage"

EXPECTED_FACTS = {
    "version": "1.0.0",
    "long_document": {
        "filename": "long-document.md",
        "facts": [
            {
                "id": "fact-beginning",
                "location": "beginning",
                "section": "第一章 总则与基本原则",
                "query": "基础津贴",
                "text": "第一条：基础津贴标准为每月五百元整，由街道社会工作服务站按月统计发放。",
                "must_appear_before_char": 1000,
            },
            {
                "id": "fact-middle",
                "location": "middle",
                "section": "第五章 中期运营与跨期审批",
                "query": "中途审批",
                "text": "第四十五条：中途审批必须在三个工作日内由财务部复核，超时未答复视为需要补充资料。",
                "must_appear_between_chars": [12000, 25000],
            },
            {
                "id": "fact-footnote",
                "location": "middle",
                "section": "第五章 中期运营与跨期审批",
                "query": "涉外项目",
                "text": "[^1]: 补充说明：涉外项目开支执行单独的外币兑换核算标准。",
                "must_appear_between_chars": [12000, 25000],
            },
            {
                "id": "fact-final",
                "location": "final",
                "section": "第十章 终期考核与资产清算",
                "query": "年终清算",
                "text": "第一百二十条：末尾条款特别声明：所有年终清算款项必须在十二月三十一日前结算归零。",
                "must_appear_after_char": 32000,
            },
            {
                "id": "fact-exception",
                "location": "final",
                "section": "第十章 终期考核与资产清算",
                "query": "紧急救援",
                "text": "例外规定：紧急救援支出不受第一百二十条清算期限限制。",
                "must_appear_after_char": 32000,
            },
            {
                "id": "fact-late-table",
                "location": "final",
                "section": "第十章 终期考核与资产清算",
                "query": "结算尾项",
                "text": "| 结算尾项 | 9999元 | 最终确认无误 |",
                "must_appear_after_char": 32000,
            },
        ],
    },
    "distractor_document": {
        "filename": "distractor.md",
        "description": "Same keywords (津贴, 审批, 清算) but irrelevant narrative context.",
        "keywords": ["津贴", "审批", "清算", "财务部"],
    },
    "short_terms": {
        "filename": "short-terms.md",
        "terms": ["报销", "条例", "纪律", "津贴", "审批", "清算"],
    },
    "evaluation_fixtures": {
        "sample.docx": {
            "has_footnote": True,
            "footnote_text": "电子发票同样需要归档。",
            "table_text": "社区培训 2000",
            "heading": "社区项目执行规范",
        },
        "text.pdf": {
            "has_cid_font": True,
            "chinese_text": "社区培训计划",
            "latin_table": "Project Budget Training 2000",
        },
        "mixed-pages.pdf": {
            "page_1_has_text": True,
            "page_2_is_scanned": True,
        },
    },
}

BASELINE_REPORT = {
    "report_version": "1.0.0",
    "evaluated_at": "2026-10-15",
    "production_caps": {
        "RAW_PROPOSE_CHARS": 12000,
        "ASK_KNOWLEDGE_EXTRACT_MAX_CHARS": 32000,
        "ITEM_TEXT_LIMIT": 4000,
        "DEFAULT_MAX_RESULT_CHARS": 24000,
        "DEFAULT_MAX_RESULT_TOKENS": 6000,
    },
    "observed_production_behavior": {
        "propose_reads_prefix_only": {
            "limit": 12000,
            "impact": "Facts appearing after character 12,000 (middle, final, late table) are never proposed for wiki extraction.",
            "verified_in": "packages/experimental/desktop-ask-knowledge/python/kb/src/octopus_kb_compound/propose.py",
        },
        "session_extract_clips_prefix": {
            "limit": 32000,
            "impact": "Content after character 32,000 is truncated with truncated=true and omitted from session-only text.",
            "verified_in": "packages/experimental/desktop-ask-knowledge/src/extract.ts",
        },
        "retrieve_clips_item_prefix": {
            "limit": 4000,
            "impact": "Individual items returned by retrieve-bundle clip at 4,000 chars, dropping later passage context.",
            "verified_in": "packages/experimental/desktop-ask-knowledge/python/kb/src/octopus_kb_compound/retrieve.py",
        },
        "word_extraction_flattens_structure": {
            "impact": "extract-docx.ts extracts plain w:t tags without headings, tables, or footnotes.",
            "verified_in": "packages/experimental/desktop-ask-knowledge/src/extract-docx.ts",
        },
        "upload_bytes_discarded": {
            "impact": "Original uploaded file is unlinked immediately after conversion; original bytes not preserved.",
            "verified_in": "packages/experimental/desktop-ask-knowledge/src/upload-temp.ts",
        },
        "in_process_mutex_insufficient": {
            "impact": "createMutex in library-lock.ts is an in-process Promise map; cannot coordinate cross-process companion/workers.",
            "verified_in": "packages/experimental/desktop-ask-knowledge/src/library-lock.ts",
        },
    },
    "format_routing_baseline": {
        "md_txt": "Preserved UTF-8; full file written to raw/",
        "docx": "Flattened to plain paragraphs; footnotes/headings omitted",
        "xlsx": "Sheet tables converted; uncached formulas empty",
        "csv": "Parsed with csv.reader; quoted commas preserved",
        "html_json": "Converted via local readers; preserved",
        "pptx": "Rejected by current product entry; requires optional python-pptx",
        "epub_rtf": "Rejected by current product entry",
        "pdf_text": "Extracted via pypdf/markitdown; CID-font Chinese supported",
        "pdf_mixed": "Page 1 extracted, page 2 image dropped without warning",
        "pdf_scan": "Empty extraction fails with ingest-failed",
    },
}


def build_long_document() -> str:
    """Generate a realistic Markdown document of ~36,000 characters."""
    parts: list[str] = []
    parts.append("# 社区社会组织综合管理办法（二零二六年度试行规程）\n\n")
    parts.append("## 第一章 总则与基本原则\n\n")
    parts.append("第一条：基础津贴标准为每月五百元整，由街道社会工作服务站按月统计发放。\n\n")
    parts.append(
        "第二条：本办法适用于所有经民政部门备案登记并在本辖区内开展公益服务活动的社会组织、志愿服务队及社区微基金托管团队。\n\n"
    )

    # Chapters 2 to 4 padding (~16,000 characters)
    for chap in range(2, 5):
        parts.append(f"## 第{chap}章 业务规范与日常登记标准\n\n")
        for art in range(1, 18):
            art_num = (chap - 2) * 17 + art + 2
            parts.append(f"### 第{art_num}条 规范规程第{art}项\n\n")
            parts.append(
                f"社区社会组织在开展日常公益服务第{art}项活动时，应当严格遵守活动安全与财务登记规程。"
                f"活动负责人必须在活动开展前五个工作日内向街道社区服务中心提交详细的活动预案与人员清单。"
                f"预案内容必须包含活动目标、参与对象、安全防护措施、预算分摊明细以及突发事件应急联络网。"
                f"所有参与志愿者均需经过不少于两小时的岗前培训，并如实记录志愿服务工时。\n\n"
            )
            parts.append(
                "各相关部门应当加强协同监管，推动社区公益资源合规流转，强化信息公开与透明度。"
                "定期对服务满意度进行抽样调查，确保群众切实受益，各项台账记录完整备查，保存期限不得少于三年。"
                "凡发现资金流向异常或服务台账失实的，街道办事处有权暂停拨付补贴并启动联合核查程序。\n\n"
            )

    # Middle fact (around char 17,000)
    parts.append("## 第五章 中期运营与跨期审批\n\n")
    parts.append(
        "第四十五条：中途审批必须在三个工作日内由财务部复核，超时未答复视为需要补充资料。\n\n"
    )
    parts.append(
        "[^1]: 补充说明：涉外项目开支执行单独的外币兑换核算标准。\n\n"
    )

    # Chapters 6 to 9 padding (~18,000 characters)
    for chap in range(6, 10):
        parts.append(f"## 第{chap}章 监督评估与过程留痕\n\n")
        for art in range(1, 20):
            art_num = 45 + (chap - 6) * 19 + art
            parts.append(f"### 第{art_num}条 督查评估第{art}项\n\n")
            parts.append(
                f"社会组织承接的公益创投项目在执行过程中，应当接受街道与第三方评估机构的联合巡查。"
                f"凡涉及资金使用超过一万元的项目，必须单独设立银行辅助账目，并在中期评估阶段提交全部发票底联、转账凭证与签收名册。"
                f"严禁虚报冒领、截留挪用项目资金。评估结果将作为下一年度项目承接资格与资助额度的关键依据。\n\n"
            )
            parts.append(
                "对于评估中发现的不规范问题，街道办事处将下达限期整改通知书。社会组织应当在接到通知之日起十个工作日内完成整改并提交书面报告。"
                "逾期未完成整改或者整改不合格的，将视情节暂停或取消其资金拨付资格，并记入诚信记录档案。"
                "评估机构应当坚持客观公正原则，结合现场问卷、财务抽查与个案访谈形成综合评估报告。\n\n"
            )

    # Final Chapter: > 33,000 characters
    parts.append("## 第十章 终期考核与资产清算\n\n")
    parts.append(
        "第一百二十条：末尾条款特别声明：所有年终清算款项必须在十二月三十一日前结算归零。\n\n"
    )
    parts.append(
        "例外规定：紧急救援支出不受第一百二十条清算期限限制。\n\n"
    )
    parts.append("### 资产清算统计明细表\n\n")
    parts.append("| 结算科目 | 结算金额 | 审核结论 |\n")
    parts.append("| :--- | :--- | :--- |\n")
    parts.append("| 基础津贴清算 | 6000元 | 核实发放无误 |\n")
    parts.append("| 紧急救援储备 | 15000元 | 结转下年度 |\n")
    parts.append("| 结算尾项 | 9999元 | 最终确认无误 |\n\n")
    parts.append("附则：本办法自发布之日起施行，由社会事务科负责解释。\n")

    return "".join(parts)


def build_distractor_document() -> str:
    """Generate a distractor document with similar keywords but irrelevant facts."""
    return """# 地方民俗志：清代商会账房与年终故事

## 第一卷 账房沿革

在古代商业市镇，账房先生负责年终盘点。
传言当时的伙计若有零碎杂费，常请掌柜给予**津贴**作为茶水补助。
然而这种**津贴**纯属私人恩惠，并无固定制度或章程。

## 第二卷 年关结算与审批

每年腊月，掌柜需要对往来账目进行**审批**。
有些账房先生会协助老板核对欠条，这个**审批**过程通常要经历数周，全凭老板心情。
凡是遇到坏账，商会便会组织同行进行债务**清算**。
在此类**清算**中，主要按亲疏远近决定偿付顺序，**财务部**之概念在当时尚未诞生。

因此，古代商会的**清算**与现代社会组织的规章制度毫无关联。
"""


def build_short_terms_document() -> str:
    """Document for testing 2-character Chinese queries, radicals, and folded characters."""
    return """# 专有名词与词条索引

本文档收录关键政策专名及核查词条：
- 报销：所有报销凭证必须加盖公章与经办人签字。
- 条例：严格执行中央八项规定及相关条例实施细则。
- 纪律：全体人员必须严守政治纪律与工作纪律。
- 津贴：明确发放对象与津贴计算基数。
- 审批：实行分级审批与限时办结制度。
- 清算：做好项目收尾与资产清算交接。

特殊字符与大小写测试：
- 全角字符：ＡＢＣＤＥＦＧ，１２３４５６
- 德语与折叠：der straße und der STRASSE
- 组合字符：e\u0301 (é) 与 \u00e9 (é)
"""


def generate_all_fixtures() -> None:
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)

    long_doc = build_long_document()
    (FIXTURES_DIR / "long-document.md").write_text(long_doc, encoding="utf-8")
    char_count = len(long_doc)
    print(f"Generated long-document.md: {char_count} characters")

    distractor = build_distractor_document()
    (FIXTURES_DIR / "distractor.md").write_text(distractor, encoding="utf-8")
    print("Generated distractor.md")

    short_terms = build_short_terms_document()
    (FIXTURES_DIR / "short-terms.md").write_text(short_terms, encoding="utf-8")
    print("Generated short-terms.md")

    (FIXTURES_DIR / "expected-facts.json").write_text(
        json.dumps(EXPECTED_FACTS, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("Generated expected-facts.json")

    (FIXTURES_DIR / "baseline-report.json").write_text(
        json.dumps(BASELINE_REPORT, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("Generated baseline-report.json")


def verify_fixtures() -> bool:
    """Verify that all required fixtures and expected facts exist and match specifications."""
    long_doc_path = FIXTURES_DIR / "long-document.md"
    if not long_doc_path.is_file():
        print("ERROR: long-document.md missing")
        return False

    text = long_doc_path.read_text(encoding="utf-8")
    if len(text) < 35000:
        print(f"ERROR: long-document.md too short ({len(text)} < 35000 chars)")
        return False

    facts = EXPECTED_FACTS["long_document"]["facts"]
    for fact in facts:
        idx = text.find(fact["text"])
        if idx == -1:
            print(f"ERROR: Fact text not found: {fact['id']}")
            return False
        if "must_appear_before_char" in fact and idx >= fact["must_appear_before_char"]:
            print(f"ERROR: Fact {fact['id']} appeared at {idx}, expected before {fact['must_appear_before_char']}")
            return False
        if "must_appear_after_char" in fact and idx <= fact["must_appear_after_char"]:
            print(f"ERROR: Fact {fact['id']} appeared at {idx}, expected after {fact['must_appear_after_char']}")
            return False
        if "must_appear_between_chars" in fact:
            lo, hi = fact["must_appear_between_chars"]
            if not (lo <= idx <= hi):
                print(f"ERROR: Fact {fact['id']} appeared at {idx}, expected between {lo} and {hi}")
                return False

    print("All long-document facts verified at correct character offsets.")
    return True


if __name__ == "__main__":
    if "--verify" in sys.argv:
        success = verify_fixtures()
        sys.exit(0 if success else 1)
    generate_all_fixtures()
    if not verify_fixtures():
        sys.exit(1)
