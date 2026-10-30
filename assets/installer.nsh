; Ao desinstalar (não em atualização), remove a inicialização automática registrada pelo app.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.rotinadesktop.app"
  ${endIf}
!macroend
