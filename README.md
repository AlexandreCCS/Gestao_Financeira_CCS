# Gestor Financeiro CCS

> Última atualização: 05/05/2026 (Alexandre Carvalho)

SaaS de gestão financeira que conecta no Oracle MEGA Quality (`OCPDB493`) via SOAP `apiquality1.ccstecno.com.br`. Hospedado em Docker na VPS Hostinger, mesmo padrão de Projetos Quality.

- **URL**: https://gestorfinanceiro.ccstecno.com.br
- **DNS**: A record no HostGator → IP VPS Hostinger
- **Login**: usuário Mega via `MEGA.CCS_F_VALIDA_LOGIN_PRJ` (compartilhado com Projetos Quality)
- **Permissão**: coluna nova `GLO_GRUPO_USUARIOCMPESP.GRU_CH_GFIN_CCS` ('A'/'U'/'N')

## Funcionalidades v1

- ✅ **Fluxo de Caixa Consolidado por período** (diário / semanal / mensal)
  - Origem: `FIN_CONTASRECEBER` (entradas) e `FIN_CONTASPAGAR` (saídas), filtrando por data de pagamento
  - Filtro por filial (ou todas)
  - KPIs: Entradas / Saídas / Líquido
  - Gráfico (barras + linha de saldo) e tabela detalhada

## Estrutura

```
gestor-financeiro/
├── api/              Fastify 5 (porta 3000 → 127.0.0.1:3020)
│   └── src/
│       ├── auth/jwt.js
│       ├── soap/mega.js          (SOAP wrapper + loginMega)
│       └── routes/
│           ├── auth.js
│           └── fluxoCaixa.js
├── web/              React 19 + Vite + Tailwind (nginx → 127.0.0.1:3021)
│   └── src/
│       ├── pages/{Login,FluxoCaixa}.jsx
│       ├── components/Shell.jsx
│       └── api/client.js
├── sql/
│   ├── 00_permissao.sql           (DDL: ALTER TABLE + UPDATE)
│   ├── 01_pck_fluxo_caixa.sql     (PL/SQL: TYPE + FUNCTION pipelined)
│   └── 99_deploy_oracle.mjs       (deployer SOAP)
├── vps/
│   ├── Caddyfile.snippet
│   └── setup.sh
├── docker-compose.yml
└── .env.example
```

## Deploy

```bash
# 1. SQL (uma vez)
cd sql && node 99_deploy_oracle.mjs

# 2. Sobe stack
cp .env.example .env  # edite os segredos
docker compose up -d --build

# Ou na VPS:
bash vps/setup.sh
```

## Próximos passos (próximas iterações)

- Contas a Pagar / Contas a Receber (lista + ações)
- Conciliação bancária (`FIN_CONCILIAMOVIMENTO`)
- Lançamentos manuais
- Aprovação de pagamentos (workflow)
- Relatórios DRE simplificado
- Notificações (e-mail Resend, WhatsApp Z-API)

## Referências

- Doc técnica reutilizável: [`Padroes_Tecnicos_MEGA_CCS.md`](../../../../../Instruções/Padroes_Tecnicos_MEGA_CCS.md)
- Projeto-base: [`projetos-quality/`](../projetos-quality/)
