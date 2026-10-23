# Remediation review: compatibility intake

Verdict: approved for local integration into master. R1 and R2 from second-review.md are closed for the tested internal macOS ARM64 channel. Product head: `00729d3c76a59d273b0691c0323b7426ae691d3b`. The subsequent documentation/evidence commit does not change product code.

## R1: dependency classification and parallel build

Restored connection-process to connection-desktop devDependencies. The desktop Node build now resolves the process-carrier root import to its completed emitted lib/types/index.js, before workspace library bundling can replace lib/index.js. No dependency-policy exemption or gate suppression was added.

The regression fixture places conflicting current and stale gateway markers in emitted and published inputs and builds the actual desktop configuration. It fails before the resolver fix and passes afterward. The real dependency verifier now passes all 75 managed packages. Scoped type-aware lint, normal commit hooks, the committed-source root build and Tauri release build pass. The initial post-commit Tauri attempt correctly rejected the earlier build identity; rebuilding at the committed head resolved it without bypassing the identity check.

Review rechecked that the resolver applies only to the desktop Node configuration, leaves browser static linking unchanged, consumes compiler output rather than a concurrent bundle, and keeps the published runtime self-contained. The test's dummy inputs are owner-local; no existing generated artifact is overwritten to obtain a pass.

## R2: native entry and installed image

The original blank/AX-only observations were caused by the isolated duplicate app remaining in the background. Activating and raising the exact test PID made the real WKWebView interactive. The installed /Applications app (PID 31760) was neither stopped nor modified. Private HOME/CFFIXED_USER_HOME/DSH_HOME, kernel loopback confinement and protection of the existing singleton socket remained in place.

Native observations covered invalid-key rejection and inert valid-format key setup without inference; the canonical Flash label; selecting Pro and Low reasoning; both English and Chinese UI; live small-window menus; default-OFF context discovery; live activation and the real Context Insights dashboard; Ask Data sample preparation and Ask Knowledge entry; assistant catalog names and saved team Flash override. No team discussion or model inference was started. Persisted route/effort and team selections were inspected only in the synthetic profile.

The unchanged copy from the final DMG preserved Pro/Low and context ON after cold start and actual payload revision refresh. Its native context dashboard opened, live deactivation removed the contribution, and another cold start preserved OFF with Flash/High. Native 640×500 model options remained visible and within the window (screenshot attached). Companion socket inspection showed only 127.0.0.1. Both owned native runs exited and the original singleton socket inode/mtime remained unchanged.

The test matrix now states native live resize separately from built-browser document zoom: the Tauri shell has no page-zoom command. The earlier 125% document-zoom scenario passed against unchanged C2 code. A test-only debugger attachment probe was cancelled without attaching or modifying the app; it is not counted as verification. No unsupported native page-zoom feature is claimed.

The final bundle passes all 114 checks. The copied final DMG passes context Host/Rust-refresh/built-Client acceptance. Source bundle, read-only mounted app and copied app have identical 51512-file digest `fb8240529328c480f1dd3b0429a4f41906b890bee5a42e117501cff4f66e542c`; strict copied-app signature verification passes. Final DMG: 324261809 bytes, SHA-256 `774cb18310f8a8fde215ec4e9304258905e770d884fc80c3ac6ea641604b7131`.

## Remaining baseline limits

The historical broad lint/export-packaging/knowledge-package/scrollbar failures remain documented and are outside the product changes reviewed here. They are not reported as passing. The branch-introduced dependency violation is fixed. There are no remaining required findings for this bounded local merge. Public signing/notarization, Windows/Intel and paid API qualification are not established by this internal ARM64 result.

## Integration and preservation

Target is the existing default branch master; no local main exists. Canonical unrelated dirty work must remain byte-identical. Overlapping desktop changes already incorporated by the prerequisite checkpoint are absorbed into the reviewed implementation; their original bytes, patch and hashes must be retained in the preservation archive before merge. Original pre-lint variants are not reapplied over the reviewed fixes. Only merged redundant branches/worktrees may be deleted. Merge/cleanup evidence is recorded separately after execution.
