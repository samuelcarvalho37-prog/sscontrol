# Rodada 1 — Perfis de demonstração

## Mudanças

O seed atribui os usuários de Qualidade, Segurança e Manutenção aos códigos existentes `QUALIDADE`, `SEGURANCA` e `TECNICO`. O código do banco é TECNICO; nenhum papel foi renomeado. Somente o vínculo antigo desses três usuários com GESTOR_TECNICO tem sua vigência encerrada. Papéis secundários permanecem preservados.

Novas matrículas: `USR-PCM-DEMO` e `USR-PRO-DEMO`. As senhas são configuradas por `DEMO_PCM_PASSWORD` e `DEMO_PRODUCAO_PASSWORD`, documentadas no `.env.example`. Valores locais não entram no Git. Credenciais já existentes não são sobrescritas ao repetir o seed, e concessões existentes não são convertidas de DENY para ALLOW.

## Contrato e banco

Sem migration nova. O seed exige os cinco papéis funcionais ativos no tenant, conforme o contrato da rodada de identidade. Ausência de um deles causa rollback integral com mensagem específica. A seleção do papel usa tenant e código, não IDs presumidos para os papéis CUSTOM. GESTOR_TECNICO e OPERADOR continuam no catálogo.

O seed continua sendo uma massa completa de homologação: além dos logins, prepara seu catálogo e cenários demonstrativos. É bloqueado em produção. Deve ser usado no banco destinado à demonstração.

## Verificação

`npm run db:migrate` confirmou schema 0017 atualizado; `npm run seed:homologation` foi aplicado no banco local. Typecheck do backend passou.

`node --env-file=.env --import tsx scripts/verify-demo-logins.mjs` confirmou login, identidade, sessão e logout dos sete perfis. O helper não imprime tokens nem senhas e recusa produção/banco remoto. Capacidades observadas: ADMIN=36, QUALIDADE=7, SEGURANCA=7, TECNICO=13, OPERADOR=14, PCM=28, PRODUCAO=5.

Suíte completa `npm test`: 18 testes aprovados, sem falhas, cancelamentos ou testes pulados. Log local: `results-1788943595292.log`.
