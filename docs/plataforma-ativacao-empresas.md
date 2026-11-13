# Acesso da empresa na Plataforma

- A lista de empresas oferece Desativar empresa e Reativar empresa, com confirmação.
- Desativar muda o ambiente para SUSPENDED, sem apagar dados nem alterar o contrato.
- O resolvedor de tenant já exige empresa ativa em cada autenticação de requisição, incluindo sessões existentes.
- Reativar restaura o acesso conforme as permissões e o contrato existentes.
- A alteração exige sessão autenticada da Plataforma e registra o operador, a empresa e os estados anterior e seguinte na auditoria.
- Aplicar a migração `0062_platform_tenant_status.sql` e reiniciar a API após o build.
- Teste PostgreSQL: `tests/platform-tenant-status.test.ts`, com `PCM_IMPORT_TEST_URL`. O teste suspende e reativa dentro de uma transação revertida, verifica a resolução do tenant, a preservação do contrato, a auditoria e a rejeição de operador inválido.

A limpeza solicitada das empresas de homologação é uma operação local de dados e não faz parte do commit nem é executada pela migração.
