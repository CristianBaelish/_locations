@echo off
cd /d "%~dp0"
echo Escuchando en la red LAN (puerto 5173). Usa la IPv4 de Wi-Fi en ipconfig.
npm.cmd run dev:lan
