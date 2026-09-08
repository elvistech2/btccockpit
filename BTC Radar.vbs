' Abre o BTC Radar sem piscar janela de console.
' Quem instalou pelo BTC-Radar-Setup.exe nao precisa disto: usa o "BTC Radar.exe".
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\windows\iniciar.ps1""", 0, False
