# Handoff VORQIX: Plataforma, TI e PCM

Este conjunto reúne as alterações necessárias de interface, API e banco para as frentes Plataforma, TI e PCM.

## Ordem dos commits

1. `feat(platform): completa console e gestão de clientes`
2. `feat(ti): amplia administração, equipes, importação e suporte`
3. `feat(pcm): organiza dashboard e lousa configurável`

## Banco de dados

Não é necessário manter uma lista de migrações em um arquivo de configuração separado. O migrador do Node lê os arquivos `NNNN_nome.sql` de `database/postgres/migrations`, em ordem, compara cada versão com `platform.schema_migrations` e aplica apenas as pendentes. Os arquivos SQL são parte obrigatória deste handoff.

Para aplicar as migrações depois de atualizar o código e configurar o ambiente do backend:

```powershell
npm --prefix backend/node-api run db:migrate
```

O comando usa `MIGRATION_DATABASE_URL` quando configurada; caso contrário, usa `DATABASE_URL`. Ele requer acesso ao banco alvo. A migração não é executada automaticamente quando a API inicia.

Este conjunto acrescenta as migrações `0043`, `0044` e `0046` a `0057`. A `0045_platform_console_and_support.sql` já faz parte do histórico anterior da branch e continua necessária.

## Validação local

Executar após aplicar as migrações em um banco de homologação compatível:

```powershell
npm --prefix backend/node-api run typecheck
npm --prefix backend/node-api run build
npm --prefix frontend-gestor run typecheck
npm --prefix frontend-gestor run build
```

Não copie arquivos `.env`, credenciais, sessões ou dados locais para outro ambiente. Configure as variáveis de conexão no ambiente do Samuel antes de executar o migrador.
