# PCM — acompanhamento e encaminhamento operacional

## Navegação e apresentação

A aba **Acompanhamento** fica entre **Manutenção** e **Conta**. Usa as variáveis do tema da lousa e a apresentação do planejamento PCM. A interface do TI permanece independente.

Os contadores são calculados no PostgreSQL, sem depender dos 50 registros da página. Os filtros separam todas as ordens, execução, bloqueios, programação vencida, fila e conclusão. Busca, setor e paginação são processados no servidor. A consulta é atualizada a cada 30 segundos enquanto a aba do navegador está visível.

Programação vencida significa que a data programada passou e a OS continua aberta. Rascunhos, ordens concluídas e canceladas não entram nesse contador. Isso não representa um SLA de conclusão que ainda não foi definido.

## Criar e executar trabalho

1. O PCM publica um checklist diretamente ou solicita a revisão opcional de Qualidade/Segurança. Uma versão em revisão não pode ser usada para execução.
2. Um checklist publicado oferece **Criar OS com este checklist**. Também pode ser escolhido diretamente no Acompanhamento, assim como um plano publicado.
3. Para uso direto de um checklist, o servidor cria e reutiliza um plano operacional vinculado àquela versão. A operação preserva o ativo, componente, modo de parada, bloqueio e tempo estimado. Esse vínculo interno dispensa o cadastro manual de outro plano.
4. O PCM informa o trabalho, prioridade, programação e responsável, ou disponibiliza para a equipe.
5. **Salvar e enviar para execução** cria a OS, libera o trabalho e atribui o técnico quando escolhido. Sem exigência adicional, não há aprovação humana intermediária do TI.

Se o cadastro for salvo e uma etapa posterior de encaminhamento falhar, a tela informa a OS já criada e permite consultar/repetir o encaminhamento. Não deve criar outra OS para resolver essa falha. A conversão de ocorrência também preserva o vínculo existente para impedir duplicação.

O responsável pode ser atribuído posteriormente no detalhe. Executor é a pessoa que assumiu a execução; não deve ser confundido com a pessoa inicialmente designada. A pausa exibe o motivo registrado, por exemplo, aguardando peça.

## Ocorrências da produção

Na guia **Ocorrências**, o PCM pode tratar agora, agendar uma data futura ou recusar com justificativa. A decisão é auditada, exposta na consulta da ocorrência e comunicada ao usuário que a registrou.

O agendamento gera um lembrete individual sem duplicação quando a data chega. A verificação ocorre nas consultas da central de notificações; não depende de um serviço externo de mensagens. Recusar uma ocorrência não declara que uma parada física foi resolvida e não fecha automaticamente a parada do equipamento.

O botão **Criar OS** leva o ativo e o relato para o formulário e restringe os roteiros àquele ativo. Uma ocorrência com OS vinculada não oferece nova conversão.

## Solicitação de atualização

O PCM pode solicitar atualização ou justificativa ao responsável e ao executor atual. O servidor persiste a notificação, os destinatários e a auditoria na mesma transação. Sem responsável ou executor, a solicitação é recusada com orientação para atribuir alguém. A justificativa operacional de uma pausa continua no fluxo de execução do técnico.

## Importação contextual

- Ativos e estrutura: ativos/equipamentos e componentes.
- Materiais: materiais.
- Áreas e cargos técnicos: áreas técnicas e cargos.

Plantas, setores e linhas são exclusivos do TI. As rotas PCM também bloqueiam esses tipos; ocultar a opção na interface não é a única proteção. Exportação administrativa não é concedida ao PCM por essa funcionalidade.

## Registros aprovados e assinaturas

Ao abrir Documentos no TI, registros autenticados ainda não arquivados são materializados em arquivos CSV rastreáveis, em lotes de até 100 por consulta. Cada registro possui um código único baseado no identificador original. O arquivo inclui responsável, área/perfil, data, origem, revisão e hash disponível.

Assinaturas técnicas e pareceres aprovados são identificados separadamente. Um parecer autenticado não é apresentado como uma assinatura criptográfica independente. A criação dos documentos usa bloqueio transacional para impedir duplicação e remove o arquivo produzido se a gravação falhar.

## Atualização do ambiente

Aplicar as migrações `0058`, `0059` e `0060` pelo procedimento de migração do projeto antes de iniciar a API atualizada. `0059` concede as capacidades operacionais do PCM; `0060` adiciona decisão e data de tratamento da ocorrência.

```powershell
npm --prefix backend/node-api run db:migrate
npm --prefix backend/node-api run build
npm --prefix frontend-gestor run build
```

O comando de migração precisa utilizar a configuração de migração do ambiente. Não copiar credenciais, banco, sessões ou arquivos privados da homologação de Natan.

## Verificação

Há testes de contrato das rotas frontend e testes de integração PostgreSQL para importação, consulta do acompanhamento, notificações, decisões, lembretes, reaproveitamento do plano do checklist e criação/liberação da OS. Os testes de integração usam `PCM_IMPORT_TEST_URL` e revertem seus dados com `ROLLBACK`.

O arquivamento documental foi verificado com armazenamento simulado e metadados reais em transação revertida. A conferência visual do acompanhamento usa respostas controladas; não substitui a homologação autenticada de todos os perfis no ambiente de destino.
