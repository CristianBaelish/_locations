@echo off
:: Ejecutar con clic derecho -> "Ejecutar como administrador"
:: Abre TCP 3001 (API) y 5173-5180 (Vite si cambia de puerto)
echo.
echo Agregando reglas de firewall (requiere este .cmd como administrador)...
netsh advfirewall firewall delete rule name="LivePOV API 3001" >nul 2>&1
netsh advfirewall firewall delete rule name="LivePOV Vite dev" >nul 2>&1
netsh advfirewall firewall delete rule name="LivePOV Vite preview" >nul 2>&1
netsh advfirewall firewall add rule name="LivePOV API 3001" dir=in action=allow protocol=TCP localport=3001
netsh advfirewall firewall add rule name="LivePOV Vite dev" dir=in action=allow protocol=TCP localport=5173-5180
netsh advfirewall firewall add rule name="LivePOV Vite preview" dir=in action=allow protocol=TCP localport=4173
if errorlevel 1 (
  echo.
  echo ERROR: No se pudo agregar la regla. Usa clic derecho en este archivo -^> Ejecutar como administrador.
  pause
  exit /b 1
)
echo.
echo Listo. Reinicia dev-lan.cmd y probá de nuevo en el celular con la URL "Network" que muestra Vite.
echo.
pause
