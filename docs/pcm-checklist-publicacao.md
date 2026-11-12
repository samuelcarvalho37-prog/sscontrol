# PCM: publicação de checklist e planejamento

## Liberação do modelo

- Salvar rascunho mantém a versão indisponível para execução.
- Sem assinatura, o PCM submete e publica a versão pelas rotas existentes `submit` e `publish`. As permissões e verificações do servidor continuam obrigatórias.
- Com assinatura, o envio usa `submit-configured`. As opções são Qualidade, Segurança, Qualidade ou Segurança (uma assinatura) e Qualidade e Segurança (duas assinaturas).
- Uma versão aprovada ainda precisa ser publicada. O editor oferece essa ação quando aplicável.
- Área de destino classifica o modelo. Publicar um checklist não cria uma ordem de serviço nem atribui automaticamente trabalho a um técnico.

## Pré-configurações e estimativa

Modo de parada, necessidade de bloqueio LOTO e estimativa são armazenados na versão do checklist. Ao selecionar esse checklist no plano, o formulário recupera essas sugestões e permite revisá-las.

A estimativa é indicativa: cinco minutos de preparação, pesos por tipo de etapa e fator de criticidade, arredondados para cima em blocos de cinco minutos. Não representa medição de campo. A periodicidade determina quando executar e não multiplica a duração estimada.

## Assistente de plano

O cadastro foi dividido em nome e tipo, aplicação, programação e revisão. Inclui corretiva planejada e melhoria planejada. O exemplo fictício da lista é somente uma prévia e não grava dados.

## Fluxo atual de plano e ordem de serviço

O repositório separa publicação de plano de liberação de OS. Após o esclarecimento da regra em 11/11/2026, o PCM também publica seus planos. A migração 0059 concede `maintenance.plans.publish`, `cmms.imports.manage` e edição de estrutura técnica ao PCM. O provisionamento deixa de remover a publicação desse perfil.

1. PCM prepara e salva o plano em rascunho.
2. PCM disponibiliza a versão pela lista, vinculada a um checklist publicado.
3. PCM cria a OS a partir do plano ativo e publicado.
4. A OS passa pelas regras de aprovação aplicáveis.
5. PCM libera a OS aprovada; o servidor cria a ação e notifica os técnicos elegíveis.

As ações Editar, Disponibilizar e Arquivar aparecem na própria linha de planos. Arquivar exige confirmação e preserva o registro. Publicar um plano não inicia uma OS automaticamente.

## Importação pelo PCM

Ativos e estrutura, Materiais e Áreas e cargos técnicos oferecem um diálogo de importação próprio. Ele lista campos obrigatórios, permite baixar um modelo de preenchimento, selecionar arquivo/aba, verificar linhas e confirmar o lote validado. Não oferece exportação de dados.

As rotas `/v1/pcm/imports/models`, `/validate` e `/:batchId/confirm` exigem `cmms.imports.manage`. Cada tipo também exige a capacidade de edição correspondente. A confirmação só aceita o lote criado pelo próprio usuário, dentro do escopo da empresa. Rotas administrativas de backup, exportação e gestão de documentos não são concedidas por essa capacidade.

Áreas e cargos usam os mesmos cadastros do TI, com interface PCM independente. Importe as áreas primeiro e depois seus cargos. Os modelos de cargos não alteram permissão de assinatura.

## Ativação

Esta entrega exige as migrações `0058_checklist_execution_defaults.sql` e `0059_pcm_operational_permissions.sql` e `0060_pcm_occurrence_treatment.sql` antes de executar a nova API. A primeira adiciona pré-configurações às versões; a segunda ajusta as capacidades do PCM.

Use o procedimento de migração do ambiente, com a conexão do proprietário das tabelas, e execute `npm --prefix backend/node-api run db:migrate`. Não substitua a conexão de execução da API por uma conta proprietária permanente.

No ambiente local de Natan, a tentativa com a conta da API foi revertida por falta de permissão. A migração foi posteriormente aplicada com sucesso usando a credencial local protegida do proprietário. Nenhum plano fictício foi inserido no banco. Samuel precisa aplicar a mesma migração no ambiente dele antes de iniciar a nova API.

## Verificações

- Compilações de frontend e backend.
- Testes de contrato para assinatura zero, política de duas assinaturas e pré-configuração de execução.
- Testes de parâmetros SQL para criação, atualização e revisão de checklist.
- Integração com PostgreSQL após a migração ainda requer validação no ambiente de destino.

## Acompanhamento

Consulte [pcm-acompanhamento.md](pcm-acompanhamento.md) para o envio de OS, ocorrências, paginação, notificações e arquivamento dos registros aprovados.
