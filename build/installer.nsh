; Extra pieces for the Windows installer (electron-builder NSIS).
; On the last page of the setup there is a checkbox to choose Gigabeam as the default PDF app. Windows does not let a program take over
; PDF files by itself (the user has to confirm), so ticking it opens the "Default apps" page of Windows Settings.
; (Only for the installer: the uninstaller is built from the same script and must not get this checkbox.)
!ifndef BUILD_UNINSTALLER
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Make Gigabeam my default PDF app (opens Windows Settings)"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION GigabeamOpenDefaultApps

  Function GigabeamOpenDefaultApps
    ExecShell "open" "ms-settings:defaultapps"
  FunctionEnd
!endif
