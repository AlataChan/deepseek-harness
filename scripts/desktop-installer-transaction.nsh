; Fork-owned payload transaction. All paths are installation siblings, never user-data homes.
!include LogicLib.nsh
Var TxStage
Var TxBackup
Var TxJournal
Var TxTarget
Var TxRetries
Var TxError
Var TxMutex

; Retry only sharing/access/lock violations. Other errors preserve their original code.
!macro TxRetryError retryLabel failureLabel
  ${If} $TxError != 5
  ${AndIf} $TxError != 32
  ${AndIf} $TxError != 33
    Goto ${failureLabel}
  ${EndIf}
  IntOp $TxRetries $TxRetries - 1
  ${If} $TxRetries <= 0
    Goto ${failureLabel}
  ${EndIf}
  Sleep 250
  Goto ${retryLabel}
!macroend

Function TxFail
  ; Before any replacement, remove only the journal; staged bytes stay recoverable.
  IfFileExists "$TxBackup\*.*" tx_keep_journal 0
  Delete "$TxJournal"
  tx_keep_journal:
  DetailPrint "Payload replacement failed (Windows error $TxError). Existing payload: $TxTarget; backup: $TxBackup; staged candidate: $TxStage; recovery journal: $TxJournal"
  SetErrorLevel 2
  IfSilent +2
    MessageBox MB_ICONSTOP "Installation failed (Windows error $TxError). Close this application's companion and retry. Recovery data is preserved at $TxJournal and $TxBackup."
  Quit
FunctionEnd

Function TxFlushJournal
  System::Call 'kernel32::CreateFileW(w "$TxJournal", i 0x40000000, i 7, p 0, i 3, i 0, p 0) p.r0 ?e'
  Pop $TxError
  ${If} $0 = -1
    Call TxFail
  ${EndIf}
  System::Call 'kernel32::FlushFileBuffers(p r0) i.r1 ?e'
  Pop $TxError
  System::Call 'kernel32::CloseHandle(p r0)'
  ${If} $1 = 0
    Call TxFail
  ${EndIf}
FunctionEnd

Function TxBegin
  ; Keep simultaneous installers from modifying one transaction journal.
  System::Call 'kernel32::CreateMutexW(p 0, i 1, w "Local\octopus_DSH_PayloadInstaller") p.r0 ?e'
  Pop $TxError
  StrCpy $TxMutex $0
  ${If} $TxMutex = 0
  ${OrIf} $TxError = 183
    DetailPrint "Another octopus installer is active; no payload or journal was changed."
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $TxTarget $INSTDIR
  StrCpy $TxJournal "$INSTDIR.octopus-transaction.ini"
  IfFileExists "$TxJournal" tx_recover tx_prepare
  tx_recover:
    ReadINIStr $TxBackup "$TxJournal" "transaction" "backup"
    ReadINIStr $TxStage "$TxJournal" "transaction" "stage"
    ; Never overwrite a possibly complete installation after a crash.
    IfFileExists "$INSTDIR\*.*" tx_unresolved 0
    IfFileExists "$TxBackup\*.*" 0 tx_unresolved
    System::Call 'kernel32::MoveFileExW(w "$TxBackup", w "$INSTDIR", i 8) i.r0 ?e'
    Pop $TxError
    ${If} $0 != 0
      Delete "$TxJournal"
      DetailPrint "Restored interrupted installation from $TxBackup; rerun the installer. Candidate retained at $TxStage."
    ${EndIf}
  tx_unresolved:
    StrCpy $TxError 183
    Call TxFail
  tx_prepare:
    System::Call 'kernel32::GetCurrentProcessId() i.r0'
    System::Call 'kernel32::GetTickCount() i.r1'
    StrCpy $TxStage "$INSTDIR.octopus-stage-$0-$1"
    StrCpy $TxBackup "$INSTDIR.octopus-backup-$0-$1"
    ; No overwrite of stale staging or recovery content.
    IfFileExists "$TxStage\*.*" tx_collision 0
    IfFileExists "$TxBackup\*.*" tx_collision 0
    ClearErrors
    CreateDirectory "$TxStage"
    IfErrors tx_collision
    WriteINIStr "$TxJournal" "transaction" "stage" "$TxStage"
    WriteINIStr "$TxJournal" "transaction" "backup" "$TxBackup"
    WriteINIStr "$TxJournal" "transaction" "target" "$TxTarget"
    WriteINIStr "$TxJournal" "transaction" "state" "staging"
    IfErrors tx_collision
    Call TxFlushJournal
    Return
  tx_collision:
    StrCpy $TxError 183
    Call TxFail
FunctionEnd

; Deny sharing explicitly: a surviving resources/node.exe must not evade the shell check.
!macro TxProbeFile relativePath unique
  StrCpy $TxRetries 40
  tx_probe_retry_${unique}:
  IfFileExists "$TxTarget\${relativePath}" 0 tx_probe_done_${unique}
  System::Call 'kernel32::CreateFileW(w "$TxTarget\${relativePath}", i 0x80000000, i 0, p 0, i 3, i 0, p 0) p.r0 ?e'
  Pop $TxError
  ${If} $0 = -1
    !insertmacro TxRetryError tx_probe_retry_${unique} tx_commit_failed
  ${EndIf}
  System::Call 'kernel32::CloseHandle(p r0)'
  tx_probe_done_${unique}:
!macroend

Function TxCommit
  !insertmacro TxProbeFile "${MAINBINARYNAME}.exe" main
  !insertmacro TxProbeFile "resources\node.exe" node
  !insertmacro TxProbeFile "resources\kb-runtime\octopus-kb-sidecar\octopus-kb-sidecar.exe" sidecar
  WriteINIStr "$TxJournal" "transaction" "state" "replacing"
  Call TxFlushJournal
  ClearErrors
  IfFileExists "$TxTarget\*.*" 0 tx_publish
  StrCpy $TxRetries 40
  tx_backup_retry:
    System::Call 'kernel32::MoveFileExW(w "$TxTarget", w "$TxBackup", i 8) i.r0 ?e'
    Pop $TxError
    ${If} $0 = 0
      !insertmacro TxRetryError tx_backup_retry tx_commit_failed
    ${EndIf}
  tx_publish:
    StrCpy $TxRetries 40
  tx_publish_retry:
    !ifdef OCTOPUS_TEST_FAIL_PUBLISH
      StrCpy $TxError 5
      Goto tx_rollback
    !endif
    System::Call 'kernel32::MoveFileExW(w "$TxStage", w "$TxTarget", i 8) i.r0 ?e'
    Pop $TxError
    ${If} $0 = 0
      !insertmacro TxRetryError tx_publish_retry tx_rollback
    ${EndIf}
    WriteINIStr "$TxJournal" "transaction" "state" "committed"
    ; Backups are deliberately retained: an install root may hold unowned files.
    DetailPrint "Installed payload committed. Previous installation retained at $TxBackup"
    Delete "$TxJournal"
    Return
  tx_rollback:
    ; Preserve TxError from publication even if restoring also fails.
    IfFileExists "$TxBackup\*.*" 0 tx_commit_failed
    !ifdef OCTOPUS_TEST_FAIL_ROLLBACK
      StrCpy $0 0
    !else
      System::Call 'kernel32::MoveFileExW(w "$TxBackup", w "$TxTarget", i 8) i.r0'
    !endif
    ${If} $0 != 0
      WriteINIStr "$TxJournal" "transaction" "state" "rolled-back"
    ${EndIf}
  tx_commit_failed:
    Call TxFail
FunctionEnd
