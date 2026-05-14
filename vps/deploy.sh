#!/usr/bin/env bash
# [05/05/2026 - Alexandre Carvalho] Redeploy local apos pull
set -e
cd /home/ccs/gestor-financeiro
git pull --ff-only || true
docker compose build
docker compose up -d
docker compose ps
