# Acesso da empresa na Plataforma

- A lista de empresas oferece Desativar empresa e Reativar empresa, com confirmação.
- Desativar muda o ambiente para SUSPENDED, sem apagar dados nem alterar o contrato.
- O resolvedor de tenant já exige empresa ativa em cada autenticação de requisição, incluindo sessões existentes.
- Reativar restaura o acesso conforme as permissões e o contrato existentes.
- A alteração exige sessão autenticada da Plataforma e registra o operador, a empresa e os estados anterior e seguinte na auditoria.
- Aplicar a migração `0062_platform_tenant_status.sql` e reiniciar a API após o build.
- Teste PostgreSQL: `tests/platform-tenant-status.test.ts`, com `PCM_IMPORT_TEST_URL`. O teste suspende e reativa dentro de uma transação revertida, verifica a resolução do tenant, a preservação do contrato, a auditoria e a rejeição de operador inválido.

A limpeza solicitada das empresas de homologação é uma operação local de dados e não faz parte do commit nem é executada pela migração.

## Aviso e encerramento no aplicativo

- Aplicar também `0063_tenant_access_state.sql`. A autenticação diferencia empresa desativada, assinatura suspensa e validade encerrada, respeitando a carência já configurada no contrato.
- O portal encerra a sessão local assim que recebe o bloqueio. Uma verificação a cada 15 segundos cobre telas sem interação; abas ocultas verificam novamente ao receber foco. Sem rede não há encerramento indevido.
- O TI recebe a causa e a orientação para procurar o suporte da Plataforma. Os demais perfis recebem uma orientação genérica para procurar o responsável da empresa.
- A Plataforma mantém seu login independente. As verificações de acesso não alteram contrato, vencimento ou dados da empresa.
- A saída não é uma transmissão instantânea para todos os dispositivos: acontece na próxima resposta de bloqueio ou na consulta periódica, conforme a conexão.
- Validação adicional: teste PostgreSQL `tenant-access-state.test.ts`, teste do resolvedor de tenant e `frontend-gestor/scripts/company-access.test.mjs` para avisos, falha de rede, eventos de bloqueio, retorno de aba e ausência de consultas sobrepostas.
