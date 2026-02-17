Set WshShell = CreateObject("WScript.Shell")
' Ejecuta el script de node sin mostrar ventana (0) y sin esperar a que termine (false)
' Ajusta la ruta a donde tengas el proyecto. Como usamos WSL, llamamos a wsl.exe
WshShell.Run "wsl.exe -d Ubuntu -u estarducs -e bash -l -c 'cd /home/estarducs/fna-tracker && /home/estarducs/.nvm/versions/node/v24.13.1/bin/node scripts/track-activity.mjs'", 0, False
