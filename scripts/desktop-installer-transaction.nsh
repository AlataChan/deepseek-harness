; Fork-owned payload transaction. All paths are installation siblings, never user-data homes.
!include LogicLib.nsh
Var TxStage
Var TxBackup
Var TxJournal
Var TxTarget
Var TxRetries
Var TxError
Var TxMutex
Var TxJournalOwned
Var TxPreviousMoved
Var TxState
Var TxRecoveryError
Var TxToken
Var TxCheckRoot
Var TxCheckOperation
Var TxMissing

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
  ${If} $TxJournalOwned = 1
  ${AndIf} $TxPreviousMoved = 0
    Delete "$TxJournal"
  ${EndIf}
  DetailPrint "Payload replacement failed (Windows error $TxError; recovery error $TxRecoveryError). Existing payload: $TxTarget; backup: $TxBackup; staged candidate: $TxStage; recovery journal: $TxJournal"
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

; Validate recovery paths before moving anything read from a journal.
Function TxValidatePath
  StrCpy $R7 $R9
  StrLen $0 $R8
  StrCpy $1 $R9 $0
  StrCmp $1 $R8 0 tx_invalid_path
  StrCpy $R9 $R9 "" $0
  StrCmp $R9 "" tx_invalid_path
  StrCpy $R6 0
  StrCpy $1 $R9 1
  StrCmp $1 "-" tx_invalid_path
  tx_path_char:
    StrCpy $1 $R9 1
    StrCmp $1 "" tx_path_valid
    StrCmp $1 "-" tx_path_separator
    StrCmp $1 "0" tx_path_next
    StrCmp $1 "1" tx_path_next
    StrCmp $1 "2" tx_path_next
    StrCmp $1 "3" tx_path_next
    StrCmp $1 "4" tx_path_next
    StrCmp $1 "5" tx_path_next
    StrCmp $1 "6" tx_path_next
    StrCmp $1 "7" tx_path_next
    StrCmp $1 "8" tx_path_next
    StrCmp $1 "9" tx_path_next
    Goto tx_invalid_path
  tx_path_separator:
    IntOp $R6 $R6 + 1
    IntCmp $R6 1 0 tx_invalid_path tx_invalid_path
    StrCpy $1 $R9 1 1
    StrCmp $1 "" tx_invalid_path
  tx_path_next:
    StrCpy $R9 $R9 "" 1
    Goto tx_path_char
  tx_path_valid:
    IntCmp $R6 1 0 tx_invalid_path tx_invalid_path
    StrCpy $R9 $R7
    Call TxRejectReparse
    Return
  tx_invalid_path:
    StrCpy $TxError 87
    Call TxFail
FunctionEnd

Function TxRejectReparse
  System::Call 'kernel32::GetFileAttributesW(w "$R9") i.r0'
  ${If} $0 != -1
    IntOp $1 $0 & 0x400
    ${If} $1 != 0
      StrCpy $TxError 87
      Call TxFail
    ${EndIf}
  ${EndIf}
FunctionEnd

Function TxRemoveJournal
  System::Call 'kernel32::DeleteFileW(w "$TxJournal") i.r0 ?e'
  Pop $TxError
  ${If} $0 = 0
    Call TxFail
  ${EndIf}
FunctionEnd

Function TxPathMissing
  StrCpy $TxMissing 0
  System::Call 'kernel32::GetFileAttributesW(w "$R9") i.r0 ?e'
  Pop $TxError
  ${If} $0 = -1
    ${If} $TxError = 2
    ${OrIf} $TxError = 3
      StrCpy $TxMissing 1
    ${Else}
      Call TxFail
    ${EndIf}
  ${EndIf}
FunctionEnd

Function TxCheckPayload
  InitPluginsDir
  File /oname=$PLUGINSDIR\octopus-installer-state.ps1 "${__FILEDIR__}\desktop-installer-state.ps1"
  IfErrors tx_state_invalid
  nsExec::ExecToStack /TIMEOUT=120000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\octopus-installer-state.ps1" -Operation "$TxCheckOperation" -Root "$TxCheckRoot" -Token "$TxToken"'
  Pop $0
  Pop $1
  ${If} $0 == 0
    Return
  ${EndIf}
  tx_state_invalid:
    StrCpy $TxError 13
    Call TxFail
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
  StrCpy $TxRecoveryError 0
  StrCpy $TxJournalOwned 0
  StrCpy $TxPreviousMoved 0
  StrCpy $TxTarget $INSTDIR
  StrCpy $TxJournal "$INSTDIR.octopus-transaction.ini"
  StrCpy $R9 $TxTarget
  Call TxRejectReparse
  StrCpy $R9 $TxJournal
  Call TxRejectReparse
  IfFileExists "$TxJournal" tx_recover tx_prepare
  tx_recover:
    ReadINIStr $TxBackup "$TxJournal" "transaction" "backup"
    ReadINIStr $TxStage "$TxJournal" "transaction" "stage"
    ReadINIStr $TxToken "$TxJournal" "transaction" "token"
    ReadINIStr $TxState "$TxJournal" "transaction" "state"
    ReadINIStr $0 "$TxJournal" "transaction" "target"
    StrCmp $0 $TxTarget 0 tx_unresolved
    StrCpy $R8 "$INSTDIR.octopus-backup-"
    StrCpy $R9 $TxBackup
    Call TxValidatePath
    StrCpy $R8 "$INSTDIR.octopus-stage-"
    StrCpy $R9 $TxStage
    Call TxValidatePath
    StrCmp $TxBackup "$INSTDIR.octopus-backup-$TxToken" 0 tx_unresolved
    StrCmp $TxStage "$INSTDIR.octopus-stage-$TxToken" 0 tx_unresolved
    ${If} $TxState == "staging"
    ${OrIf} $TxState == "ready"
      StrCpy $R9 $TxBackup
      Call TxPathMissing
      ${If} $TxMissing = 1
        ; No old payload was moved: preserve the candidate and allow a clean rerun.
        Call TxRemoveJournal
        Goto tx_prepare
      ${EndIf}
    ${EndIf}
    ${If} $TxState == "replacing"
      StrCpy $R9 $TxBackup
      Call TxPathMissing
      ${If} $TxMissing = 1
        StrCpy $R9 $TxStage
        Call TxPathMissing
        ${If} $TxMissing = 0
          ; The old installation was never renamed, including first-install interruptions.
          Call TxRemoveJournal
          Goto tx_prepare
        ${EndIf}
      ${EndIf}
    ${EndIf}
    ${If} $TxState == "committed"
    ${OrIf} $TxState == "replacing"
      IfFileExists "$TxTarget\${MAINBINARYNAME}.exe" 0 tx_check_restore
      IfFileExists "$TxTarget\resources\node.exe" 0 tx_unresolved
      StrCpy $R9 $TxStage
      Call TxPathMissing
      ${If} $TxMissing != 1
        Goto tx_unresolved
      ${EndIf}
      StrCpy $TxCheckRoot $TxTarget
      StrCpy $TxCheckOperation "verify"
      Call TxCheckPayload
      Call TxRemoveJournal
      Goto tx_prepare
    ${EndIf}
    tx_check_restore:
    ; Never overwrite a possibly complete installation after a crash.
    IfFileExists "$INSTDIR\*.*" tx_unresolved 0
    IfFileExists "$TxBackup\${MAINBINARYNAME}.exe" 0 tx_unresolved
    IfFileExists "$TxBackup\resources\node.exe" 0 tx_unresolved
    System::Call 'kernel32::MoveFileExW(w "$TxBackup", w "$INSTDIR", i 8) i.r0 ?e'
    Pop $TxRecoveryError
    ${If} $0 != 0
      Call TxRemoveJournal
      DetailPrint "Restored interrupted installation from $TxBackup; rerun the installer. Candidate retained at $TxStage."
    ${EndIf}
  tx_unresolved:
    StrCpy $TxError 183
    ${If} $TxRecoveryError != 0
      StrCpy $TxError $TxRecoveryError
    ${EndIf}
    Call TxFail
  tx_prepare:
    System::Call 'kernel32::GetCurrentProcessId() i.r0'
    System::Call 'kernel32::GetTickCount64() l.r1'
    StrCpy $TxToken "$0-$1"
    StrCpy $TxStage "$INSTDIR.octopus-stage-$TxToken"
    StrCpy $TxBackup "$INSTDIR.octopus-backup-$TxToken"
    ; No overwrite of stale staging or recovery content.
    IfFileExists "$TxStage\*.*" tx_collision 0
    IfFileExists "$TxBackup\*.*" tx_collision 0
    ClearErrors
    CreateDirectory "$TxStage"
    IfErrors tx_collision
    StrCpy $TxJournalOwned 1
    WriteINIStr "$TxJournal" "transaction" "token" "$TxToken"
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
  System::Call 'kernel32::CreateFileW(w "$TxTarget\${relativePath}", i 0xC0000000, i 0, p 0, i 3, i 0, p 0) p.r0 ?e'
  Pop $TxError
  ${If} $0 = -1
    !insertmacro TxRetryError tx_probe_retry_${unique} tx_commit_failed
  ${EndIf}
  System::Call 'kernel32::CloseHandle(p r0)'
  tx_probe_done_${unique}:
!macroend

Function TxCommit
  StrCpy $TxCheckRoot $TxStage
  StrCpy $TxCheckOperation "seal"
  Call TxCheckPayload
  WriteINIStr "$TxJournal" "transaction" "state" "ready"
  Call TxFlushJournal
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
    StrCpy $TxPreviousMoved 1
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
    ClearErrors
    WriteINIStr "$TxJournal" "transaction" "state" "committed"
    IfErrors tx_commit_failed
    Call TxFlushJournal
    ; Backups are deliberately retained: an install root may hold unowned files.
    DetailPrint "Installed payload committed. Previous installation retained at $TxBackup"
    Call TxRemoveJournal
    Return
  tx_rollback:
    ; Preserve TxError from publication even if restoring also fails.
    IfFileExists "$TxBackup\*.*" 0 tx_commit_failed
    !ifdef OCTOPUS_TEST_FAIL_ROLLBACK
      StrCpy $0 0
      StrCpy $TxRecoveryError 5
    !else
      System::Call 'kernel32::MoveFileExW(w "$TxBackup", w "$TxTarget", i 8) i.r0 ?e'
      Pop $TxRecoveryError
    !endif
    ${If} $0 != 0
      StrCpy $TxPreviousMoved 0
      WriteINIStr "$TxJournal" "transaction" "state" "rolled-back"
    ${EndIf}
  tx_commit_failed:
    Call TxFail
FunctionEnd
