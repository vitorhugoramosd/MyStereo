@echo off
rem Sobe um servidor web local e abre a radio no navegador.
rem O endereco precisa ser 127.0.0.1:5500 (o Spotify nao aceita "localhost").
cd /d "%~dp0"
echo Radio Pessoal em http://127.0.0.1:5500/
echo Deixe esta janela aberta enquanto ouve. Feche-a para encerrar.
start "" "http://127.0.0.1:5500/"
python -m http.server 5500 --bind 127.0.0.1
pause
