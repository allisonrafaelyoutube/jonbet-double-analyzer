# Deploy cloud (Render + Supabase + Netlify)

Uso pessoal 24/7. Ordem recomendada:

1. Criar projeto no **Supabase** e rodar o SQL em `supabase/migrations/`
2. Subir o **Render** (Web Service) apontando para este repo, pasta `server/`
3. Publicar o dashboard no **Netlify** (pasta `web/` ou `server/public` na fase 1)

## Render

- Runtime: Node
- Root directory: `server`
- Build: `npm install`
- Start: `npm start`
- Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `POLL_MS`, `PORT`

Health check: `GET /health`

> Plano free pode dormir. Para 24/7 real, use keep-alive ou plano pago.

## Supabase

```bash
# depois: login e link do projeto
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

## Netlify

- Publish directory: `web` (quando existir) ou estático gerado
- Env pública: `SUPABASE_URL`, `SUPABASE_ANON_KEY`

## Extensão Brave (opcional)

Continua como backup local; o poller do Render é a fonte 24/7.
