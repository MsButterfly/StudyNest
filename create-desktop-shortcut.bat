@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=(Get-Location).Path; $u=([System.Uri](Join-Path $d 'index.html')).AbsoluteUri; $s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\StudyNest.lnk'); $s.TargetPath=$env:ComSpec; $s.Arguments='/c start msedge --app='+$u; $s.IconLocation=(Join-Path $d 'icon.ico'); $s.WindowStyle=7; $s.Description='StudyNest'; $s.Save()"
echo.
echo Done! Look for the StudyNest icon on your Desktop.
pause
