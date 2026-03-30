; Custom NSIS script for AI Retouch installer
; Adds helpful text on the directory page telling the user that
; "AI Retouch" will be appended automatically to their selected path.
; The actual append is handled by electron-builder's built-in instFilesPre.

!macro customHeader
  !define MUI_DIRECTORYPAGE_TEXT_TOP "Setup will install AI Retouch into the following folder.$\r$\n$\r$\nIf you choose a custom folder, an 'AI Retouch' subfolder will be created automatically."
!macroend
