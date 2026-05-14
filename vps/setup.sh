#!/usr/bin/env bash
# [05/05/2026 - Alexandre Carvalho] Setup completo na VPS Hostinger srv-ccs
# Pre-requisito: DNS de gestorfinanceiro.ccstecno.com.br apontado para o IP da VPS
# (no HostGator Zone Editor do dominio: tipo A -> <IP_VPS>)
set -e

PROJETO=/home/ccs/gestor-financeiro

echo "==> 1. Cria pasta do projeto"
mkdir -p "$PROJETO"/{redis/data,logs}
cd "$PROJETO"

echo "==> 2. .env (copie .env.example -> .env e ajuste segredos!)"
[ -f .env ] || { echo "ABORT: $PROJETO/.env nao existe. Copie de .env.example e edite."; exit 1; }
chmod 600 .env

echo "==> 3. Bloco Caddy"
SUDO="sudo -S -p ''"
PW="${SUDO_PW:-b56BaxZ9VxoojSrsZGuP}"
if ! echo "$PW" | $SUDO grep -q "gestorfinanceiro.ccstecno.com.br" /etc/caddy/Caddyfile 2>/dev/null; then
  echo "$PW" | $SUDO cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.pre-gf-$(date +%s)
  echo "$PW" | $SUDO bash -c "cat $PROJETO/vps/Caddyfile.snippet >> /etc/caddy/Caddyfile"
  echo "$PW" | $SUDO caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  echo "$PW" | $SUDO systemctl reload caddy
  echo "    Caddy recarregado"
fi

echo "==> 4. Build e sobe containers"
docker compose pull
docker compose build
docker compose up -d
docker compose ps

echo "==> 5. Healthcheck (aguarda Let's Encrypt finalizar emissao)"
sleep 8
curl -fsS https://gestorfinanceiro.ccstecno.com.br/api/health || true

echo
echo "==> Pronto. URL: https://gestorfinanceiro.ccstecno.com.br"
echo "    Logs: docker compose logs -f gf-api gf-web"
