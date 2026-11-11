# PCM — confirmação do fluxo de revisão e escopo da interface

Verificado em 10/11/2026 no checkout de front-end e na referência remota `origin/feat/vorqix-finalizacao` obtida por fetch, commit `65e8e5a3bdfa8f9cf39eb4bef67835976b9e4062`. Isto confirma o código disponível, não a configuração da máquina ou da conta de Samuel.

## Dois processos diferentes

1. Modelo de checklist: o editor salva rascunho. O comando de envio usa `maintenance.checklists.manage` e `/maintenance/checklists/:id/submit-configured`. A rota nominal define os validadores e a política de assinatura. As políticas fixas exigem Qualidade, Segurança, uma das duas ou ambas. A revisão usa `maintenance.checklists.review`. O envio configurado não oferece uma opção de ignorar todas as assinaturas. O endpoint genérico suporta versões com zero assinaturas, mas isso não significa que o fluxo atual do editor seja uma revisão opcional.
2. Liberação pós-intervenção: a OS carrega `technical_analysis.exige_liberacao_pos_intervencao`. O envio da OS à rota técnica exige `maintenance.work-orders.manage`. Sem exigência de liberação, esse envio aprova a OS sem criar a exceção. Com exigência, prepara a demanda de pós-intervenção e os requisitos de Qualidade/Segurança. A conclusão da execução coloca a demanda em `AWAITING_SIGNATURE`; a assinatura é impedida antes da execução concluída. A política define quais áreas devem assinar. A OS só encerra essa pendência após cumprir as assinaturas.

## Quem solicita

Não é correto afirmar que qualquer operador, produção ou mecânico pode escolher livremente quem avalia. O criador/gestor autorizado prepara a OS e a exigência de pós-intervenção. O executor autorizado conclui seu trabalho e isso encaminha a pendência já configurada. As capacidades, o escopo do usuário e a política técnica determinam quem pode enviar, executar e assinar. No front-end atual, o botão do técnico mostra “Concluir e encaminhar para validação” quando a OS exige essa liberação; caso contrário, “Concluir OS”. A referência antiga do Samuel não contém esse helper visual, mas possui a mesma regra de pós-intervenção no backend.

## Decisão desta entrega

A proposta anterior de revisão opcional não foi implementada. Não alteramos backend, permissões, bloqueios, política de assinatura ou liberação operacional. O novo assistente PCM reorganiza somente a apresentação. Salvar rascunho e enviar para validação continuam separados. Revisor nominal continua no diálogo de envio existente; não foi inventado um seletor de executor no modelo.

## Interface entregue

- Checklist próprio do PCM, separado do construtor visual do TI.
- Entrada com criar e biblioteca; assistente com escolha ordenada e repetível de etapas, aplicação/programação, configuração e conferência.
- Ativo obrigatório e componente opcional; somente componentes do ativo são oferecidos.
- Duplicação cria um novo rascunho independente. A exclusão continua limitada pelo contrato existente.
- Ativos abrem componentes vinculados, preservando ações e edição existentes.
- Áreas como seleção compacta, cargos da área selecionada e edição por lápis; busca contextual.

## Funcionalidades que exigem uma etapa de contrato

Não foram simuladas corretiva não programada, disparo imediato, novos regimes de programação, publicação sem assinatura ou um mesmo modelo com múltiplas aplicações. Os tipos e campos apresentados no assistente continuam os já suportados pelo editor/API. Esses complementos precisam ser definidos com Samuel antes de modificar a regra funcional.
