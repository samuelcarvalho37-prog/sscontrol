# Fluxo compartilhado de solicitação e acompanhamento de OS

Preparação da mudança acordada com Samuel em 11/11/2026.
Status: especificação preparada para implementação; funcionalidades abaixo ainda não implementadas por este documento. Base: integração local da entrega Natan1bdd8ee.

## Comportamento acordado

Produção, Operador, mecânico, eletricista, lubrificador, Qualidade e Segurança podem solicitar trabalho com botão Solicitar OS. O pedido recebe identificador rastreável e fica Aguardando avaliação do PCM. Registrar o pedido não libera execução.

O PCM avalia, complementa ativo/componente, roteiro publicado, prioridade, programação e equipe, e pode aprovar/liberar, devolver para correção ou rejeitar com justificativa. Solicitação pode ser corretiva, preventiva, lubrificação, inspeção ou melhoria quando compatível com os tipos e roteiros existentes; não criar um tipo inválido de work_order ao transportar tipos de plano. O solicitante indica necessidade de Qualidade/Segurança; PCM confirma as exigências e registra justificativa se alterar a indicação.

Todos os perfis operacionais consultam o acompanhamento autorizado da sua unidade/planta: solicitações, liberadas, programadas, em execução, pausadas, conclusão técnica, validações pendentes, concluídas, rejeitadas e canceladas. Mostrar equipamento/local, solicitante, aprovador PCM, responsável designado, executor efetivo, programação, início real, conclusão técnica, encerramento e histórico. Não confundir responsável com executor. Preservar histórico e evidências das OS existentes.

Qualidade e Segurança recebem notificações persistentes de liberação e início na planta autorizada, mesmo quando não criaram a solicitação. A lista inicial deve oferecer filtros para serviço programado, em execução e assinatura necessária. Notificar somente destinatários autorizados, sem ampliar acesso entre empresas ou plantas.

## Início e acompanhamento

Após liberação do PCM, o técnico elegível pode iniciar imediatamente, mantendo atribuição, concorrência e demais pré-condições operacionais existentes. Confirmação de presença/acompanhamento de Qualidade ou Segurança não bloqueia o botão Iniciar.

Registrar início real e executor uma única vez. Início gera aviso para áreas envolvidas. Qualidade e Segurança podem registrar Acompanhamento iniciado e observações em trilha separada das assinaturas. Ausência de resposta fica Acompanhamento pendente; nunca significa aprovação automática.

Este ajuste não remove bloqueios operacionais reais, permissões de trabalho, LOTO ou autorizações prévias exigíveis. Confirmação de presença no software e autorização prévia são conceitos distintos. Não implementar escalonamento com SLA arbitrário: manter horário programado, início real e pendência visíveis; prazo/escalonamento será configurável quando definido.

## Conclusão e assinaturas

Mecânico conclui a execução técnica com checklist/evidências exigidas. Sem validação pós-intervenção exigida, seguir encerramento existente. Com validação exigida, ficar aguardando Qualidade, Segurança ou ambas. Cada área assina somente sua etapa; uma assinatura não dispensa outra quando ambas forem obrigatórias. Devolução tem motivo e preserva versões anteriores.

Assinatura confirma a validação descrita na etapa e sua data; não declara retroativamente presença durante todo o serviço. Registros de acompanhamento comprovam sua própria autoria/data e permanecem distintos da validação final.

## Permissões

| Perfil | Solicitar | Consultar unidade autorizada | Aprovar/liberar pedido | Executar | Registrar acompanhamento | Validar final |
|---|---|---|---|---|---|---|
| Produção/Operador | Sim | Sim | Não | Apenas ações já autorizadas | Sem assinatura de área | Não |
| Mecânico/Elétrica/Lubrificação | Sim | Sim | Não | Conforme atribuição/elegibilidade | Observações da execução | Conclusão técnica |
| Qualidade | Sim | Sim | Não | Não por esta mudança | Qualidade | Qualidade quando exigida |
| Segurança | Sim | Sim | Não | Não por esta mudança | Segurança | Segurança quando exigida |
| PCM | Sim | Sim | Sim | Sem conceder execução por esta mudança | Planejamento/histórico | Aprovação PCM; não substitui área |
| TI | Sem criar OS operacionais | Administração já autorizada | Não por esta mudança | Não | Auditoria autorizada | Não substitui área |

Ampliar solicitações e leitura com capacidades específicas. Não conceder maintenance.work-orders.manage aos solicitantes para contornar a fila PCM. Respeitar escopo de planta e tenant no servidor, não apenas ocultar botões. Qualidade/Segurança não obtêm permissões de execução ou de assinatura uma da outra.

## Pontos reais do código conferidos

- POST/GET /v1/maintenance/occurrences e POST /v1/maintenance/occurrences/:occurrenceId/decision em monitoring.routes.ts: aproveitar registro, tratamento e vínculo à OS, sem renomear todas as ocorrências históricas como OS aprovadas.
- POST /v1/maintenance/work-orders em operations.routes.ts: preservar capacidade de gerenciamento para PCM e exigência de roteiro publicado.
- GET /v1/pcm/tracking: aproveitar consulta de acompanhamento, contadores, executor e pausa. Criar leitura compartilhada com contrato e autorização próprios; não abrir integralmente o workspace de gestão PCM a outros perfis.
- frontend-gestor/src/app/App.tsx: hoje OccurrenceWizard depende de canReportOccurrence e ausência de canReadWork; remover essa exclusão na nova navegação para permitir solicitar mesmo a quem já consulta OS.
- Frontend operador também possui App/OccurrenceWizard próprios. Entregar acesso equivalente nos dois portais sem obrigar técnicos a perder a tela de execução.
- Definir migrações após o último nome completo disponível. Há arquivos históricos com prefixos0058/0059 repetidos; não renomear nem editar migrações já aplicadas.

## Sequência de implementação

1. Modelagem/contratos: solicitação com tipo desejado, indicação de áreas e estado de avaliação; vínculo único com OS; devolução e rejeição justificadas; acompanhar separado de assinar. Migração aditiva e compatível com dados existentes.
2. Backend/permissões: leitura compartilhada por unidade, ações PCM, acompanhamento por área, notificações transacionais/idempotentes e trilha auditável. Nenhuma alteração direta de senha.
3. Telas: Solicitar OS e Minhas solicitações/Acompanhamento para todos os perfis, ações de iniciar técnico e de validar restritas às respectivas capacidades. Reutilizar formulário Produção e estilo recente do Natan.
4. Testes integrados em banco isolado; build; backup da homologação; migrações; revisão acompanhada por perfis. Atualizar pacote e relatório após passar; publicar apenas quando solicitado.

## Critérios de aceite

- Cada perfil operacional cria pedido e recebe identificador; não consegue aprová-lo/liberá-lo diretamente.
- Solicitação aparece ao PCM, aprovação converte/libera exatamente uma OS; duplo clique e repetição não duplicam.
- Devolução permite corrigir sem perder histórico; rejeição notifica solicitante e não encerra uma parada física automaticamente.
- Mecânico inicia OS liberada sem confirmação de presença das áreas; dois técnicos concorrentes não assumem a mesma execução indevidamente.
- Qualidade/Segurança veem liberação/início na planta correta, registram acompanhamento e recebem assinatura quando exigida.
- Início bloqueado somente pelas regras operacionais legítimas existentes, sem remover LOTO/permissões aplicáveis.
- Conclusão técnica aparece sem confundir encerramento; exigência de ambas áreas demanda duas assinaturas válidas.
- Todos consultam quem solicitou/aprovou/executou/validou; isolamento entre empresas e plantas comprovado por testes de negação.
- Pedidos e OS anteriores, consumo, pausas, transferência, cancelamento, PDF e evidências continuam funcionando.
- Notificações e decisões persistem após recarregar; leitura não cria duplicações de OS/assinaturas.

## Pendências anteriores preservadas

Captura/envio/reabertura de foto real no iPhone e aceite formal continuam pendentes. QR/câmera e PDF foram validados em versões anteriores; repetir cenários afetados pela nova alteração. Não declarar homologação global ou implantação em produção concluídas.
