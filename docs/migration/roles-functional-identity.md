# Identidade funcional por role — VORQIX

## Escopo

Rodada das fases 1–7: autenticação, administração, contratos e reconhecimento dos perfis nos dois frontends. Não inclui os novos fluxos da fase 8, integrações externas ou alterações em produção.

## Contrato e compatibilidade

- `iam.roles.code` identifica o perfil. O código é uma string aberta; cadastrar uma role CUSTOM não exige editar um enum TypeScript.
- `role_type` permanece uma categoria interna: ADMIN, MANAGER, OPERATOR ou CUSTOM.
- Login e sessão retornam `primaryRoleCode`, `roleCodes` e `roleType`. `perfil` continua presente e contém o código real; `papeis` e `capacidades` permanecem disponíveis.
- A role principal é a primeira role ativa e vigente ordenada por categoria ADMIN primeiro, código com collation PostgreSQL `C` e ID. A mesma regra é usada na administração.
- Nenhuma role ativa resulta em identidade sem role principal, e não em um OPERADOR implícito.
- GESTOR_TECNICO e OPERADOR seguem válidos. Escritas administrativas antigas com GESTOR resolvem primeiro uma role GESTOR existente e, na ausência dela, GESTOR_TECNICO. Não há conversão de toda a categoria MANAGER.
- A sessão interna de manutenção conserva seu marcador SISTEMA e seu escopo próprio.

## Autorização e edição

As capabilities continuam calculadas a cada autenticação de sessão, considerando vigência e situação da role. DENY continua prevalecendo sobre ALLOW, incluindo concessões individuais.

As APIs administrativas buscam roles ativas da empresa autenticada. A matriz usa o código da role e suas permissões, sem agregar todos os perfis CUSTOM ou MANAGER. Roles protegidas e a categoria ADMIN não podem ter seu núcleo de permissões alterado por esse editor.

O formulário atual seleciona uma role. Em uma edição, somente a atribuição principal anterior é encerrada; roles secundárias são preservadas. Selecionar a mesma role não elimina outras atribuições. A role principal resultante continua obedecendo à ordenação determinística; o campo do formulário não configura uma prioridade manual.

Os controles de escopo das execuções deixam de depender do nome OPERADOR: a consulta de execuções de outro usuário requer a capacidade de revisão de ordens. A lista de demandas usa capacidade de gestão de ordens para o escopo ampliado. Assinaturas continuam dependendo da área/cargo e dos requisitos de workflow da demanda.

## Banco

Nenhuma migration nova. A leitura do banco local confirmou ADMIN, GESTOR_TECNICO, OPERADOR e os cinco CUSTOM ativos, com PCM=28, PRODUCAO=5, TECNICO=13, QUALIDADE=7 e SEGURANCA=7 concessões ALLOW.

O banco de desenvolvimento foi apenas consultado. Os testes usam bancos novos com prefixo `vorqix_roles_test_`, copiando somente schema, catálogo de capabilities e histórico das migrations. Não copiam usuários, credenciais, sessões nem dados operacionais. Os bancos de teste ficam preservados para diagnóstico.

Preparação local, a partir de `backend/node-api`:

```powershell
node --env-file=.env scripts/prepare-role-test-db.mjs
node --env-file=.env scripts/run-role-tests.mjs
```

O helper exige PostgreSQL local e recusa ambiente PRODUCTION. `POSTGRES_BIN` permite informar a pasta das ferramentas PostgreSQL. As credenciais existentes são transmitidas pelo ambiente dos processos, sem serem gravadas nos arquivos de teste. Para repetir a suíte inteira, prepare um banco novo, pois alguns testes existentes utilizam tenants fixos.

## Continuidade

O próximo bloco é a fase 8: ocorrência guiada, interface de execução do técnico, qualidade por exceção e dashboard PCM. Esta rodada não adiciona capabilities aos perfis de homologação nem concede execução à Produção. A atribuição de área/cargo e os requisitos da demanda continuam necessários para Qualidade e Segurança assinarem.

Clientes externos que usam `perfil === 'GESTOR'` precisam migrar para capabilities e códigos reais. Os dois frontends deste repositório são atualizados nesta rodada; o backend legado Apps Script permanece fora do escopo.
