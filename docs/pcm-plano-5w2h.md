# PCM — fluxo de acompanhamento e planejamento

## Objetivo

Manter Dark, Ice e Light consistentes entre lousa, avisos, consultas e planejamento. A jornada começa no indicador, apresenta o contexto operacional e conduz a uma ação já suportada pela API. A aparência não concede permissões nem muda o significado dos indicadores.

## Plano 5W2H

| O quê | Por quê | Onde | Quem | Quando / dependência | Como | Quanto |
| --- | --- | --- | --- | --- | --- | --- |
| Unificar avisos e notificações | Liberar espaço e reunir prioridades | Cabeçalho e central operacional | Front-end; PCM usa e valida | Entrega atual | Contador compacto junto ao sino; avisos operacionais dentro da central; abrir o contexto e fechar a central ao escolher um aviso | Sem nova licença; esforço incluído nesta entrega |
| Padronizar tema e estados | Evitar superfícies brancas, ilegíveis ou estados sem contraste | PCM, central, consultas e planejamento | Front-end; Natan revisa os três temas | Entrega atual | Tokens compartilhados para superfície, texto, borda, hover, seleção e desabilitado; efeitos de vidro separados do fundo interno | Sem nova licença; revisão visual ainda necessária |
| Organizar a entrada do planejamento | Mostrar por onde começar sem texto permanente excessivo | Manutenção | PCM | Entrega atual | 1. Estrutura dos ativos e áreas/cargos; 2. Checklists e planos; 3. Materiais. Cada recurso abre uma página; ajuda contextual no botão ? | Sem novo serviço |
| Relacionar indicador e consulta | Permitir entender o valor antes de decidir | Cards e consulta operacional | PCM | Entrega atual, com os dados já retornados | Paradas e ordens usam os fluxos existentes; disponibilidade/falhas exibem resumo e registros; gráfico mensal acompanha MTTR/MTBF | Sem nova API nesta etapa |
| Completar a consulta por ativo | Levar da falha ao tratamento correto | Lista de ativos parados e detalhe da OS | PCM e Samuel | Próxima etapa, após validar os vínculos ativo → parada → OS | Reutilizar a resolução de ocorrência e as ações existentes; listar somente comandos autorizados; manter histórico e auditoria | Estimar após homologar os contratos |
| Definir edição de estrutura pelo PCM | Permitir corrigir a base sem conceder administração geral | Áreas, cargos e estrutura | Samuel define autorização; TI governa; PCM opera | Antes de ampliar acessos | Mapear leitura/edição por recurso; validar `admin.technical-structure.manage` e `cmms.structure.manage` na API; auditar alterações; testar 403 sem permissão | Sem estimativa fechada antes da definição de acesso |
| Conectar checklist, plano e execução | Preparar trabalho executável e rastreável | Planejamento → checklist → plano → OS | PCM prepara; responsáveis validam; manutenção executa | Fluxo existente; aprofundar na próxima revisão | Conferir checklist validado, ativo, gatilho, periodicidade, recursos e aprovação antes de publicar; não remover validações existentes | Reutiliza módulos atuais; complementos dependem da API |
| Estruturar o registro 5W2H do trabalho | Registrar o problema e a decisão de forma verificável | Planejamento de intervenção | PCM; Samuel valida persistência | Próxima etapa funcional | Registrar o quê, por quê, ativo/local, responsável, prazo, método/checklist e custo previsto. Depois vincular à OS; não simular persistência em um formulário local | Estimar após definir campos, API e auditoria |

## Sequência operacional

1. Acompanhar a lousa por áreas: prioridades, disponibilidade, falhas, ordens, planejamento, equipe, materiais e resultados.
2. Clicar no indicador e consultar seus registros e a janela de análise.
3. Abrir o ativo ou a OS vinculada. Se faltar vínculo, mostrar isso explicitamente.
4. Preparar o trabalho: estrutura → checklist → plano → recursos.
5. Executar uma ação permitida pela API, com confirmação quando ela alterar o processo.
6. Retornar ao acompanhamento e conferir o resultado e o histórico.

## Limites da entrega atual

- Não concede ao PCM todas as permissões do TI. A API continua decidindo autorização.
- Não cria um cadastro 5W2H persistente nem altera banco, migrações ou atribuições de usuários.
- Disponibilidade e reincidências não são recalculadas a partir de uma lista parcial. O resumo usa os indicadores da API; a lista de ativos com múltiplas falhas é contexto, não diagnóstico de causa.
- O período de análise não transforma um estado atual em histórico de paradas. Isso exige uma série de eventos própria.
- As ações de gráficos e listas continuam independentes da edição visual por botão direito.

## Critérios para homologação

- Verificar Dark, Ice e Light na lousa, seleção de cards, central, planejamento e formulários de cada recurso.
- Abrir um aviso e confirmar que a central fecha e a consulta correta aparece.
- Filtrar por área, buscar um nome e limpar os dois: posições e tamanhos do layout devem permanecer intactos.
- Confirmar que disponibilidade, falhas, reincidências e os dois indicadores mensais abrem dados coerentes com seus títulos.
- Conferir o padrão profissional com quinas retas e vidro aplicado à superfície inteira, sem camada interna residual.
- Validar edição de áreas/cargos com uma conta autorizada e recusa pela API com uma conta sem a capacidade exigida.
- Validar o encadeamento checklist → plano → OS com Samuel antes de ampliar o fluxo funcional.

## Interface própria do PCM

Catálogos e áreas/cargos técnicos do PCM possuem componentes de apresentação próprios: PcmCatalogWorkspace e PcmTechnicalStructure. Eles reutilizam os serviços e contratos existentes, sem alterar os componentes visuais do TI. Novas regras de negócio devem continuar nos serviços e na API; as duas apresentações precisam ser verificadas quando esses contratos mudarem. O editor de checklists ainda reutiliza o componente existente, com estilos restritos ao contêiner PCM.
