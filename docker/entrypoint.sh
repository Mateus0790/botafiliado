#!/bin/sh
set -e
# Tela virtual para o navegador do modo meli.la (o Mercado Livre recusa navegador sem janela).
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1366x900x24 -nolisten tcp >/dev/null 2>&1 &
exec node index.js
