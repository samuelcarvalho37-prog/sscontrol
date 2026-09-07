# PostgreSQL — Fab Control

Status: modelo da Fase 2 aprovado e fundação Node.js da Fase 3 em implementação.

## Regra de segurança

Este banco nasce em paralelo. Ele não substitui o Apps Script, não altera as planilhas e não executa migração de dados. O corte só poderá ocorrer após carga de ensaio, reconciliação, teste integral, backup restaurável e aprovação explícita.

## Versão validada

- PostgreSQL 18.4;
- extensão `pg_trgm`;
- codificação UTF-8;
- datas em `timestamptz`;
- isolamento obrigatório por `tenant_id`;
- usuário do backend sem privilégios administrativos e sem `BYPASSRLS`.

## Ordem das migrações

1. `0001_platform.sql`
2. `0002_iam.sql`
3. `0003_cmms.sql`
4. `0004_checklists_and_plans.sql`
5. `0005_operations.sql`
6. `0006_workflow_governance_migration.sql`
7. `0007_integrity_security_views.sql`
8. `0008_runtime_access.sql`
9. `0009_cmms_catalog_runtime.sql`
10. `0010_checklists_plans_runtime.sql`

Cada arquivo abre e confirma a própria transação. Uma falha interrompe a aplicação e não confirma o arquivo incompleto.

## Validação relacional local

```powershell
.\database\postgres\scripts\validate-local.ps1
```

O script cria um banco isolado, aplica todas as migrações, executa o contrato relacional e preserva o banco para inspeção.

## Validação da API com usuário restrito

```powershell
Set-Location .\backend\node-api
.\scripts\test-local.ps1
```

Esse teste:

1. cria outro banco isolado;
2. aplica as nove migrações pelo migrador Node.js;
3. cria ou atualiza somente o usuário local restrito da API;
4. executa o contrato do banco;
5. testa autenticação e o catálogo CMMS por rotas HTTP reais;
6. executa duas vezes a carga controlada de homologação;
7. preserva o banco e protege a senha local com DPAPI do Windows.

## Contratos cobertos

- RLS forçada em todas as tabelas multiempresa;
- nove tipos de resposta de checklist;
- vínculo entre componente e equipamento;
- bloqueio de checklist sem etapas;
- bloqueio de OS sem assinatura;
- assinatura permanente e imutável;
- liberação segura para a fila do Operador;
- persistência de leitura de notificação;
- grants mínimos para runtime e leitura.
- chave idempotente e classificação automática de leituras;
- unicidade de parâmetro de ativo sem componente;
- imutabilidade de leituras técnicas;
- capacidades separadas para estrutura, ativos, materiais e parâmetros;
- catálogo global protegido contra mutação pelo runtime.

## Segredos locais

Nenhuma senha ou string de conexão pertence ao repositório.

- administrador local: `%LOCALAPPDATA%\FabControl\postgres-dev-credential.xml`
- runtime Node.js local: `%LOCALAPPDATA%\FabControl\node-api-dev-credential.xml`
- último banco de teste da API: `%LOCALAPPDATA%\FabControl\last-node-api-test-db.txt`

Homologação e produção deverão usar cofre de segredos.

## Regras das próximas migrações

- nunca editar uma migração já aplicada;
- adicionar mudanças em um novo arquivo numerado;
- nunca migrar diretamente para produção;
- executar backup e ensaio de restauração antes do corte;
- definir `app.tenant_id` e `app.user_id` em cada transação;
- nunca conceder `SUPERUSER`, `CREATEDB`, `CREATEROLE` ou `BYPASSRLS` ao backend.
