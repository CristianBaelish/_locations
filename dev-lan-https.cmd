@echo off
cd /d "%~dp0"
echo HTTPS local para ubicacion en el celular (Chrome bloquea GPS con http://192.168...).
echo La primera vez Chrome avisara del certificado: Avanzado -^> Continuar.
echo.
npm.cmd run dev:lan-https
