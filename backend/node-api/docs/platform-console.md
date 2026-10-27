# Console da plataforma VORQIX

O console global fica na rota `/plataforma` e usa uma sessão própria, separada das sessões das empresas. A entrada exige senha e código TOTP de seis dígitos. O console lista empresas e planos ativos, resume a telemetria que a instância atual da API manteve em memória nos últimos 15 minutos e permite acompanhar chamados técnicos abertos pelas empresas.

## Provisionar a primeira identidade

O provisionamento é manual e só pode criar a primeira identidade. Use uma conexão de migração com permissão para executar as migrations e mantenha o terminal em ambiente privado. O comando lê a senha de variáveis de ambiente, grava somente o hash Argon2id e armazena o segredo TOTP cifrado com `AUTH_PASSWORD_PEPPER`.

No PowerShell, configure os valores apenas na sessão atual do terminal:

```powershell
$env:MIGRATION_DATABASE_URL = 'postgresql://...'
$env:PLATFORM_OPERATOR_LOGIN = 'identificador-da-equipe'
$env:PLATFORM_OPERATOR_NAME = 'Equipe da Plataforma'
$env:PLATFORM_OPERATOR_PASSWORD = 'senha-forte-gerenciada-fora-do-repositorio'
npm --prefix backend/node-api run platform:operator:create
```

O comando devolve uma URI de provisionamento TOTP uma única vez. Cadastre-a imediatamente em um aplicativo autenticador e remova as variáveis da sessão quando terminar:

```powershell
Remove-Item Env:MIGRATION_DATABASE_URL
Remove-Item Env:PLATFORM_OPERATOR_LOGIN
Remove-Item Env:PLATFORM_OPERATOR_NAME
Remove-Item Env:PLATFORM_OPERATOR_PASSWORD
```

Não salve a URI TOTP em tickets, logs ou no repositório. O segredo não pode ser recuperado pelo console. Para rotação ou recuperação, provisionar um fluxo administrativo auditado é requisito antes de operar em produção.

## Escopo disponível nesta etapa

- A sessão da plataforma tem validade de 30 minutos e pode ser revogada ao sair.
- Os endpoints de empresas e chamados exigem essa sessão global; nenhum endpoint global reutiliza o bearer de uma empresa.
- O cliente abre chamado autenticado. Tenant e usuário são derivados da sessão verificada no servidor, e a migration valida esse escopo antes de gravar.
- A equipe pode atualizar o estado de um chamado. Cada transição é auditada; chamados encerrados são terminais.
- A telemetria é por instância de API, limitada a 120 amostras por capacidade e 15 minutos. Ela não representa uso de CPU, memória, tamanho de banco ou histórico durável.
- A edição global de plano, dados empresariais, concessões de acesso temporário e a administração de contas da equipe ainda não estão expostas. Devem usar autorização temporária vinculada a chamado, empresa, ações permitidas, expiração, revogação e auditoria antes de serem habilitadas.
