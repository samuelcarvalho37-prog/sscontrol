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

## Ativação

Esta entrega exige a migração `0058_checklist_execution_defaults.sql` antes de executar a nova API. Ela adiciona `execution_defaults` às versões de checklist e aceita planos do tipo `IMPROVEMENT`.

Use o procedimento de migração do ambiente, com a conexão do proprietário das tabelas, e execute `npm --prefix backend/node-api run db:migrate`. Não substitua a conexão de execução da API por uma conta proprietária permanente.

No ambiente local de Natan, a tentativa com a conta da API foi revertida por falta de permissão. A migração foi posteriormente aplicada com sucesso usando a credencial local protegida do proprietário. Nenhum plano fictício foi inserido no banco. Samuel precisa aplicar a mesma migração no ambiente dele antes de iniciar a nova API.

## Verificações

- Compilações de frontend e backend.
- Testes de contrato para assinatura zero, política de duas assinaturas e pré-configuração de execução.
- Testes de parâmetros SQL para criação, atualização e revisão de checklist.
- Integração com PostgreSQL após a migração ainda requer validação no ambiente de destino.
