# Frontend Gestor

Aplicação React + TypeScript do gestor do Fab Control.

## Módulos disponíveis

- autenticação de `GESTOR` e `ADMIN`;
- visão operacional e KPI base;
- validação de execuções;
- validação de modelos técnicos de checklist;
- monitoramento de paradas e ocorrências;
- consulta de ativos e componentes;
- recuperação de senha com referência não enumerável;
- cadastro e edição de usuários pelo administrador;
- desbloqueio, redefinição de senha temporária e revogação de sessões;
- matriz auditável de capacidades para `GESTOR` e `OPERADOR`;
- configuração validada do endpoint da API.

## Configuração local

Copie `.env.example` para `.env.local` e informe a URL publicada do Web App:

```text
VITE_API_BASE_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

O link do editor do Apps Script não é um endpoint de API.

## Validação

```text
npm ci
npm run typecheck
npm run build
node ../tools/test-gestor-frontend-contract.mjs
node ../tools/test-admin-identity-contract.mjs
```
