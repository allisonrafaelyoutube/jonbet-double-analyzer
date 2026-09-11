# Jonbet Double Analyzer

Analisador local/cloud do jogo Double (Jonbet) para uso pessoal.

- Poller da API oficial do Double
- Dashboard com histórico, gap de branco e sequências
- Extensão Brave opcional (backup)
- Destino 24/7: **Render** (poller) + **Supabase** (dados) + **Netlify** (dashboard)

> Não é previsão mágica. Double tem vantagem da casa. Os “sinais” são lembretes/regras suas.

## Local (PC)

```bat
cd server
npm install
npm start
```

Dashboard: http://127.0.0.1:8787

Extensão: carregar a pasta `extension/` no Brave (`brave://extensions`).

## Cloud

Veja [docs/DEPLOY-CLOUD.md](docs/DEPLOY-CLOUD.md).

## Estrutura

| Pasta | Função |
|-------|--------|
| `server/` | API + poller (Render / local) |
| `extension/` | Extensão Brave (opcional) |
| `supabase/` | Migrations SQL |
| `docs/` | Specs e deploy |

## Segurança

- Sem auto-aposta
- `SUPABASE_SERVICE_ROLE_KEY` só no Render (nunca no front)
- Anon key no Netlify só com RLS de leitura
