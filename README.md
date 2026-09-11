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

## Cloud (já provisionado)

| Peça | URL |
|------|-----|
| Dashboard (Render) | https://jonbet-double-analyzer.onrender.com |
| Dashboard (Netlify)* | https://jonbet-double-analyzer.netlify.app |
| API health | https://jonbet-double-analyzer.onrender.com/health |
| Repo | https://github.com/allisonrafaelyoutube/jonbet-double-analyzer |
| Supabase | projeto `Analyze` (`aclulovomzyrvyeittxt`) |

\*Se o Netlify pedir login do time, desative **Team / Edge Access** nas configs do site, ou use o dashboard do Render.

### Importante (HTTP 451)

A API da Jonbet **bloqueia IP de datacenter** (Render retorna `HTTP 451`). O poller na nuvem sozinho não puxa giros novos.
Com a **extensão Brave** (ou o PC) aberta no Double, os giros sobem para o Render → Supabase e o painel atualiza.

Veja também [docs/DEPLOY-CLOUD.md](docs/DEPLOY-CLOUD.md).

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
