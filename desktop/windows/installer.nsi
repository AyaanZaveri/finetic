Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"
Var UpdateMode
Var UpdateWait
Var HadPrevious
Var InstallerMutex

Name "Navigator"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Navigator"
InstallDirRegKey HKCU "Software\Navigator Desktop" "InstallDir"
RequestExecutionLevel user
; Private builds favor quick packaging/extraction over a smaller download.
SetCompressor /SOLID zlib
; Modern UI applies its own Icon commands when pages are inserted.
!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName" "Navigator"
VIAddVersionKey "FileDescription" "Navigator Windows installer"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "See bundled THIRD-PARTY.md and licenses"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "This private build requires 64-bit Windows 11 on an Intel or AMD PC."
    Abort
  ${EndIf}
  SetShellVarContext current
  SetRegView 64
  ; Serialize installations before touching staging/backup folders.
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\NavigatorDesktopInstaller") p .r0 ?e'
  Pop $1
  StrCpy $InstallerMutex $0
  ${If} $0 == 0
    SetErrorLevel 2
    Abort
  ${EndIf}
  ${If} $1 == 183
    SetErrorLevel 2
    Abort
  ${EndIf}
  StrCpy $UpdateMode 0
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/UPDATE" $1
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}
  ReadRegStr $0 HKLM "Software\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  ${If} $0 < 22000
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "This private build requires Windows 11."
    Abort
  ${EndIf}
  ${If} $UpdateMode == 1
    ${GetParameters} $0
    ClearErrors
    ${GetOptions} $0 "/UPDATEPID=" $1
    ${IfNot} ${Errors}
      ; Wait on the process itself, including cleanup after the window closes.
      ; Older updaters pass only /UPDATE and use the window check below.
      System::Call 'kernel32::OpenProcess(i 0x00100000, i 0, i r1) p .r2'
      ${If} $2 != 0
        System::Call 'kernel32::WaitForSingleObject(p r2, i 30000) i .r1'
        System::Call 'kernel32::CloseHandle(p r2)'
        ${If} $1 != 0
          SetErrorLevel 3
          Abort
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  StrCpy $UpdateWait 300
  retry:
  FindWindow $0 "NavigatorDesktop"
  ${If} $0 == 0
    FindWindow $0 "NavigatorDesktopSmoke"
  ${EndIf}
  ${If} $0 != 0
    ${If} $UpdateMode == 1
      IntOp $UpdateWait $UpdateWait - 1
      ${If} $UpdateWait > 0
        Sleep 100
        Goto retry
      ${EndIf}
      SetErrorLevel 3
      IfSilent +2
      MessageBox MB_OK|MB_ICONSTOP "Navigator did not finish closing. No update was installed. Close it and try again."
      Abort
    ${EndIf}
    IfSilent busy_install
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Close Navigator before installing or upgrading it." IDRETRY retry
    busy_install:
    SetErrorLevel 3
    Abort
  ${EndIf}
FunctionEnd

; Microsoft documents this runtime GUID in the 32-bit EdgeUpdate registry view.
Function DetectWebView2
  SetRegView 32
  ReadRegStr $0 HKLM "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  SetRegView 64
FunctionEnd

Section "Navigator"
  ; Whole-directory replacement is only allowed for an owned installation.
  ; A new install may use an empty directory, never an unrelated populated one.
  FindFirst $2 $3 "$INSTDIR\*"
  check_install_directory:
    ${If} $3 == ""
      FindClose $2
      Goto install_directory_safe
    ${EndIf}
    ${If} $3 != "."
    ${AndIf} $3 != ".."
      FindClose $2
      IfFileExists "$INSTDIR\navigator-desktop.exe" 0 unsafe_directory
      IfFileExists "$INSTDIR\Uninstall.exe" 0 unsafe_directory
      IfFileExists "$INSTDIR\resources\*" 0 unsafe_directory
      Goto install_directory_safe
    ${EndIf}
    FindNext $2 $3
    Goto check_install_directory
  install_directory_safe:
  Call DetectWebView2
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    File /oname=WebView2Setup.exe "${BOOTSTRAPPER}"
    DetailPrint "Installing Microsoft Edge WebView2 Runtime…"
    ExecWait '"$PLUGINSDIR\WebView2Setup.exe" /silent /install' $1
    Call DetectWebView2
    ${If} $0 == ""
    ${OrIf} $0 == "0.0.0.0"
      SetErrorLevel 6
      IfSilent +2
      MessageBox MB_OK|MB_ICONSTOP "WebView2 could not be installed (exit code $1). Install Microsoft Edge WebView2 Evergreen Runtime, then run this installer again."
      Abort
    ${EndIf}
  ${EndIf}
  ; Never delete a backup left by an interrupted prior upgrade.
  IfFileExists "$INSTDIR.update-backup\*" recovery_needed
  IfFileExists "$INSTDIR.update-stage\*" staging_recovery_needed
  SetOutPath "$INSTDIR.update-stage"
  ClearErrors
!ifdef DELTA_DIR
  !include "${DELTA_DIR}\payload.nsh"
  IfErrors preparation_failed
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=delta.cjs "${DELTA_SCRIPT}"
  File /oname=delta-manifest.json "${DELTA_DIR}\manifest.json"
  ; The staged Navigator executable is a GUI program. It starts Node with
  ; CREATE_NO_WINDOW so Windows Terminal does not get a console to host.
  ClearErrors
  ExecWait '"$INSTDIR.update-stage\navigator-desktop.exe" --materialize-update "$INSTDIR" "$PLUGINSDIR"' $1
  IfErrors delta_failed
  ${If} $1 != "0"
    Goto delta_failed
  ${EndIf}
!else
  File /r "${PACKAGE_DIR}\*"
!endif
  IfErrors preparation_failed
  DetailPrint "Verifying startup files and preparing Navigator's local services…"
  ; Installation-only preparation loads the bundled service and video engine.
  ; The ordinary shortcut never runs this step. No antivirus settings change.
  ClearErrors
  ExecWait '"$INSTDIR.update-stage\navigator-desktop.exe" --prepare-install' $1
  IfErrors preparation_failed
  ${If} $1 != 0
    Goto preparation_failed
  ${EndIf}
  ClearErrors
  WriteUninstaller "$INSTDIR.update-stage\Uninstall.exe"
  IfErrors preparation_failed
  ; Release the installer's staging working directory before renaming it.
  SetOutPath "$TEMP"
  StrCpy $HadPrevious 0
  IfFileExists "$INSTDIR\*" 0 activate_stage
  StrCpy $UpdateWait 300
  rename_previous:
    ClearErrors
    Rename "$INSTDIR" "$INSTDIR.update-backup"
    IfErrors 0 previous_saved
    IntOp $UpdateWait $UpdateWait - 1
    ${If} $UpdateWait > 0
      Sleep 100
      Goto rename_previous
    ${EndIf}
    Goto preparation_failed
  previous_saved:
    StrCpy $HadPrevious 1
  activate_stage:
    ClearErrors
    Rename "$INSTDIR.update-stage" "$INSTDIR"
    IfErrors 0 stage_activated
    ${If} $HadPrevious == 1
      ClearErrors
      Rename "$INSTDIR.update-backup" "$INSTDIR"
      IfErrors recovery_needed
    ${EndIf}
    Goto preparation_failed
  stage_activated:
  SetOutPath "$INSTDIR"
  DetailPrint "Navigator is ready."
  CreateShortCut "$SMPROGRAMS\Navigator.lnk" "$INSTDIR\navigator-desktop.exe" "" "$INSTDIR\Navigator.ico"
  WriteRegStr HKCU "Software\Navigator Desktop" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NavigatorDesktop" "DisplayName" "Navigator"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NavigatorDesktop" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NavigatorDesktop" "DisplayIcon" "$INSTDIR\Navigator.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NavigatorDesktop" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NavigatorDesktop" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NavigatorDesktop" "NoRepair" 1
  RMDir /r "$INSTDIR.update-backup"
  ${If} $UpdateMode == 1
    Exec '"$INSTDIR\navigator-desktop.exe"'
  ${EndIf}
  Goto installation_done
  unsafe_directory:
    SetErrorLevel 5
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "Choose an empty folder or an existing Navigator installation. This folder's files were left untouched."
    Abort
  staging_recovery_needed:
    SetErrorLevel 4
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "A prior staging folder needs recovery: $INSTDIR.update-stage. Its files were left untouched."
    Abort
  recovery_needed:
    SetErrorLevel 4
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "The update needs recovery. Your previous files are in $INSTDIR.update-backup. They were left untouched."
    Abort
!ifdef DELTA_DIR
  delta_failed:
    SetOutPath "$TEMP"
    ClearErrors
    RMDir /r "$INSTDIR.update-stage"
    IfErrors staging_recovery_needed
    SetErrorLevel 13
    Abort
!endif
  preparation_failed:
    SetOutPath "$TEMP"
    RMDir /r "$INSTDIR.update-stage"
    SetErrorLevel 1
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "Navigator could not finish the update. The previous installation was retained. See %LOCALAPPDATA%\Navigator Desktop\installation.log."
    Abort
  installation_done:
SectionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
  retry:
  FindWindow $0 "NavigatorDesktop"
  ${If} $0 == 0
    FindWindow $0 "NavigatorDesktopSmoke"
  ${EndIf}
  ${If} $0 != 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Close Navigator before uninstalling it." IDRETRY retry
    Abort
  ${EndIf}
FunctionEnd

Section "Uninstall"
  ; Windows cannot remove the process's current working directory. Move out
  ; before deleting the installation tree; profile data is stored elsewhere.
  SetOutPath "$TEMP"
  Delete "$SMPROGRAMS\Navigator.lnk"
  Delete "$INSTDIR\navigator-desktop.exe"
  Delete "$INSTDIR\Navigator.ico"
  Delete "$INSTDIR\WINDOWS-README.txt"
  RMDir /r "$INSTDIR\resources"
  ; The launch stub starts this temporary uninstaller before its own process
  ; finishes exiting. Delete it last, with bounded retries for that image lock.
  StrCpy $R0 50
  uninstall_self_retry:
    ClearErrors
    Delete "$INSTDIR\Uninstall.exe"
    IfErrors 0 uninstall_self_done
    IntOp $R0 $R0 - 1
    IntCmp $R0 0 uninstall_self_done uninstall_self_done
    Sleep 100
    Goto uninstall_self_retry
  uninstall_self_done:
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Navigator Desktop"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NavigatorDesktop"
  ; Deliberately retain the user's profile, sign-in and settings.
SectionEnd
