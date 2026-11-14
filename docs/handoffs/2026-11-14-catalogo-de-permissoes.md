# Catálogo de permissões por ação

214 ações e habilitações específicas.

| Categoria | Função | Operação | Sensível | Identificador | Efeito |
| --- | --- | --- | --- | --- | --- |
| Pessoas e acesso | Consultar contas | Consulta | Não | access.get.admin.users | Consultar contas. |
| Pessoas e acesso | Criar contas | Cadastro | Sim | access.post.admin.users | Criar contas. Esta ação pode alterar o acesso de outras pessoas ao sistema. |
| Pessoas e acesso | Importar equipe | Importação | Sim | access.post.admin.users.import | Importar equipe. Esta ação pode alterar o acesso de outras pessoas ao sistema. |
| Pessoas e acesso | Editar contas | Edição | Sim | access.patch.admin.users.userId | Editar contas. Esta ação pode alterar o acesso de outras pessoas ao sistema. |
| Pessoas e acesso | Desbloquear contas | Acesso | Sim | access.post.admin.users.userId.unlock | Desbloquear contas. Esta ação pode alterar o acesso de outras pessoas ao sistema. |
| Pessoas e acesso | Redefinir senhas | Acesso | Sim | access.post.admin.users.userId.reset_password | Redefinir senhas. Esta ação pode alterar o acesso de outras pessoas ao sistema. |
| Pessoas e acesso | Encerrar sessões | Acesso | Sim | access.post.admin.users.userId.revoke_sessions | Encerrar sessões. Esta ação pode alterar o acesso de outras pessoas ao sistema. |
| Equipes técnicas | Consultar áreas técnicas | Consulta | Não | access.get.admin.technical_areas | Consultar áreas técnicas. |
| Equipes técnicas | Criar áreas técnicas | Cadastro | Não | access.post.admin.technical_areas | Criar áreas técnicas. |
| Equipes técnicas | Editar áreas técnicas | Edição | Não | access.patch.admin.technical_areas.areaId | Editar áreas técnicas. |
| Equipes técnicas | Consultar cargos técnicos | Consulta | Não | access.get.admin.technical_roles | Consultar cargos técnicos. |
| Equipes técnicas | Criar cargos técnicos | Cadastro | Não | access.post.admin.technical_roles | Criar cargos técnicos. |
| Equipes técnicas | Editar cargos técnicos | Edição | Não | access.patch.admin.technical_roles.roleId | Editar cargos técnicos. |
| Permissões | Consultar perfis de acesso | Consulta | Sim | access.get.admin.permissions | Consultar perfis de acesso. |
| Permissões | Preparar perfis padrão | Cadastro | Sim | access.post.admin.permissions.profiles.defaults | Preparar perfis padrão. Esta ação pode alterar o acesso de outras pessoas ao sistema. |
| Permissões | Criar perfis de acesso | Cadastro | Sim | access.post.admin.permissions.profiles | Criar perfis de acesso. Esta ação pode alterar o acesso de outras pessoas ao sistema. |
| Permissões | Editar perfis de acesso | Edição | Sim | access.patch.admin.permissions.profile | Editar perfis de acesso. Esta ação pode alterar o acesso de outras pessoas ao sistema. |
| Empresa | Consultar dados da empresa | Consulta | Não | access.get.admin.company | Consultar dados da empresa. |
| Empresa | Editar dados da empresa | Edição | Não | access.patch.admin.company | Editar dados da empresa. |
| Empresa | Consultar recursos contratados | Consulta | Não | access.get.admin.commercial_access | Consultar recursos contratados. |
| Configurações | Consultar configurações do sistema | Consulta | Não | access.get.admin.configuration | Consultar configurações do sistema. |
| Configurações | Verificar configurações do sistema | Validação | Não | access.post.admin.configuration.validate | Verificar configurações do sistema. |
| Configurações | Salvar rascunho de configuração | Edição | Não | access.post.admin.configuration.drafts | Criar configurações do sistema. |
| Configurações | Consultar versões de configuração | Consulta | Não | access.get.admin.configuration.versions | Consultar configurações do sistema. |
| Configurações | Publicar configurações do sistema | Publicação | Sim | access.post.admin.configuration.publish | Publicar configurações do sistema. |
| Configurações | Desfazer configurações do sistema | Restauração | Sim | access.post.admin.configuration.rollback | Desfazer configurações do sistema. |
| Configurações | Consultar catálogo do sistema | Consulta | Não | access.get.platform.motor.catalog | Consultar catálogo do sistema. |
| Configurações | Verificar catálogo do sistema | Validação | Não | access.post.platform.motor.catalog.validate | Verificar catálogo do sistema. |
| Configurações | Salvar rascunho do catálogo | Edição | Não | access.post.platform.motor.catalog.drafts | Criar catálogo do sistema. |
| Configurações | Consultar versões do catálogo | Consulta | Não | access.get.platform.motor.catalog.versions | Consultar catálogo do sistema. |
| Configurações | Publicar catálogo do sistema | Publicação | Sim | access.post.platform.motor.catalog.publish | Publicar catálogo do sistema. |
| Configurações | Desfazer catálogo do sistema | Restauração | Sim | access.post.platform.motor.catalog.rollback | Desfazer catálogo do sistema. |
| Auditoria | Consultar auditoria | Consulta | Não | access.get.admin.audit | Consultar auditoria. |
| Integridade | Consultar integridade do sistema | Consulta | Não | access.get.admin.monitoring | Consultar integridade do sistema. |
| Acompanhamento | Consultar análises técnicas | Consulta | Não | access.get.admin.technical_analyses | Consultar análises técnicas. |
| Revisão técnica | Consultar demandas administrativas | Consulta | Não | access.get.admin.technical_demands | Consultar demandas técnicas. |
| Estrutura | Consultar estrutura da empresa | Consulta | Não | access.get.cmms.structure | Consulta a árvore de plantas, setores e linhas. |
| Estrutura | Criar plantas | Cadastro | Não | access.post.cmms.plants | Cadastra uma planta. |
| Estrutura | Editar plantas | Edição | Não | access.patch.cmms.plants.plantId | Altera ou desativa uma planta. |
| Estrutura | Criar setores | Cadastro | Não | access.post.cmms.sectors | Cadastra um setor em uma planta ativa. |
| Estrutura | Editar setores | Edição | Não | access.patch.cmms.sectors.sectorId | Altera ou desativa um setor. |
| Estrutura | Criar linhas | Cadastro | Não | access.post.cmms.lines | Cadastra uma linha em um setor ativo. |
| Estrutura | Editar linhas | Edição | Não | access.patch.cmms.lines.lineId | Altera ou desativa uma linha. |
| Ativos e componentes | Consultar ativos | Consulta | Não | access.get.cmms.assets | Pesquisa ativos com filtros e paginação por cursor. |
| Ativos e componentes | Localizar equipamento por TAG | Consulta | Não | access.get.cmms.assets.resolve.code | Resolve TAG ou QR Code de equipamento ou componente. |
| Identificação | Ler QR Code | Consulta | Não | access.get.cmms.qr_context.code | Resolve QR/TAG e entrega o contexto operacional completo em uma consulta. |
| Ativos e componentes | Consultar detalhes de ativos | Consulta | Não | access.get.cmms.assets.assetId | Consulta a ficha técnica completa de um ativo. |
| Ativos e componentes | Consultar histórico do ativo | Consulta | Não | access.get.cmms.assets.assetId.history | Consulta o histórico técnico paginado de um ativo ou componente. |
| Ativos e componentes | Criar ativos | Cadastro | Não | access.post.cmms.assets | Cadastra um ativo e gera seu QR Code canônico. |
| Ativos e componentes | Registrar leituras | Operação | Não | access.post.cmms.assets.assetId.readings | Registra leitura manual pelo contexto do equipamento ou componente. |
| Ativos e componentes | Editar ativos | Edição | Não | access.patch.cmms.assets.assetId | Editar a ficha técnica do ativo. Alterar situação ou arquivar exige as permissões específicas. |
| Ativos e componentes | Consultar componentes do ativo | Consulta | Não | access.get.cmms.assets.assetId.components | Lista os componentes de um ativo. |
| Ativos e componentes | Consultar componentes | Consulta | Não | access.get.cmms.components | Pesquisa componentes no catálogo técnico do tenant. |
| Ativos e componentes | Criar componentes | Cadastro | Não | access.post.cmms.components | Cadastra um componente e gera seu QR Code canônico. |
| Ativos e componentes | Editar componentes | Edição | Não | access.patch.cmms.components.componentId | Editar a ficha técnica do componente. Alterar situação ou arquivar exige as permissões específicas. |
| Materiais | Consultar materiais | Consulta | Não | access.get.cmms.materials | Consulta materiais, estoque e necessidade de reposição. |
| Materiais | Criar materiais | Cadastro | Não | access.post.cmms.materials | Cadastra um material técnico. |
| Materiais | Editar materiais | Edição | Não | access.patch.cmms.materials.materialId | Editar a identificação e os dados do material. Alterar saldo, custo ou situação exige as permissões específicas. |
| Parâmetros e leituras | Criar parâmetros | Cadastro | Não | access.post.cmms.parameters | Cadastra uma definição de parâmetro técnico. |
| Parâmetros e leituras | Editar parâmetros | Edição | Não | access.patch.cmms.parameters.parameterId | Altera ou desativa uma definição de parâmetro. |
| Parâmetros e leituras | Publicar limites de parâmetros | Publicação | Sim | access.post.cmms.parameters.parameterId.policies | Publica uma versão imutável dos limites de um parâmetro. |
| Parâmetros e leituras | Consultar parâmetros | Consulta | Não | access.get.cmms.parameters.parameterId.readings | Consulta o histórico classificado de leituras. |
| Parâmetros e leituras | Registrar leituras | Operação | Não | access.post.cmms.parameters.parameterId.readings | Registra e classifica uma leitura técnica idempotente. |
| Documentos | Consultar documentos | Consulta | Não | access.get.admin.documents | Consultar documentos. |
| Documentos | Consultar detalhes de documentos | Consulta | Não | access.get.admin.documents.documentId | Consultar documentos. |
| Documentos | Criar documentos | Cadastro | Não | access.post.admin.documents | Criar documentos. |
| Documentos | Editar documentos | Edição | Não | access.patch.admin.documents.documentId | Editar documentos. |
| Documentos | Abrir arquivo de documento | Consulta | Não | access.get.admin.document_files.objectId | Consultar arquivos de documentos. |
| Importação | Consultar modelos de importação do PCM | Consulta | Não | access.get.pcm.imports.models | Consultar importações. |
| Importação | Verificar importações | Validação | Não | access.post.pcm.imports.validate | Verificar importações. |
| Importação | Confirmar importação | Importação | Não | access.post.pcm.imports.batchId.confirm | Confirmar importação. |
| Importação | Consultar modelos de importação | Consulta | Não | access.get.admin.imports.models | Consultar importações. |
| Importação | Consultar importações | Consulta | Não | access.get.admin.imports | Consultar importações. |
| Importação | Consultar detalhes de importações | Consulta | Não | access.get.admin.imports.batchId | Consultar importações. |
| Importação | Verificar importações | Validação | Não | access.post.admin.imports.validate | Verificar importações. |
| Importação | Confirmar importação | Importação | Não | access.post.admin.imports.batchId.confirm | Confirmar importação. |
| Importação | Desfazer importações | Restauração | Sim | access.post.admin.imports.batchId.rollback | Desfazer importações. |
| Importação | Arquivar importações | Arquivamento | Sim | access.post.admin.imports.batchId.dismiss | Arquivar importações. |
| Cópias e restauração | Consultar cópias de segurança | Consulta | Não | access.get.admin.backups | Consultar cópias de segurança. |
| Cópias e restauração | Criar cópias de segurança | Cadastro | Não | access.post.admin.backups | Criar cópias de segurança. |
| Cópias e restauração | Preparar restauração | Restauração | Sim | access.post.admin.backups.backupId.prepare | Preparar restauração. |
| Cópias e restauração | Restaurar cópia de segurança | Restauração | Sim | access.post.admin.backups.backupId.restore | Restaurar cópia de segurança. |
| Cópias e restauração | Baixar cópia de segurança | Exportação | Não | access.get.admin.backups.backupId.file | Baixar cópia de segurança. |
| Ocorrências | Decidir tratamento da ocorrência | Operação | Não | access.post.maintenance.occurrences.occurrenceId.decision | PCM decide tratar, agendar ou recusar uma ocorrência. |
| Ocorrências | Consultar ocorrências | Consulta | Não | access.get.maintenance.occurrences | Consulta ocorrências operacionais. |
| Ocorrências | Criar ocorrências | Cadastro | Não | access.post.maintenance.occurrences | Registra uma ocorrência e, quando necessário, abre a parada. |
| Ocorrências | Consultar detalhes de ocorrências | Consulta | Não | access.get.maintenance.occurrences.occurrenceId | Consulta ocorrência, parada e análise relacionadas. |
| Ocorrências | Registrar análise técnica | Operação | Não | access.post.maintenance.occurrences.occurrenceId.technical_analysis | Emite análise técnica permanente ao PCM. |
| Parâmetros e leituras | Criar solicitações sobre parâmetros | Cadastro | Não | access.post.monitoring.parameter_action_requests | Converte uma leitura técnica em ocorrência e análise para o PCM. |
| Paradas | Consultar paradas | Consulta | Não | access.get.maintenance.stops | Consulta paradas abertas e concluídas. |
| Paradas | Criar paradas | Cadastro | Não | access.post.maintenance.stops | Abre uma parada técnica rastreável. |
| Paradas | Consultar detalhes de paradas | Consulta | Não | access.get.maintenance.stops.stopId | Consulta uma parada técnica. |
| Paradas | Atualizar situação da parada | Operação | Não | access.post.maintenance.stops.stopId.transition | Movimenta a parada até o retorno operacional. |
| Paradas | Criar tratamento da parada | Operação | Não | access.post.maintenance.stops.stopId.create_treatment | Abre de forma idempotente o tratamento de uma parada técnica. |
| Avisos | Consultar alertas | Consulta | Não | access.get.maintenance.alerts | Consulta alertas deduplicados. |
| Avisos | Reconhecer alerta | Operação | Não | access.post.maintenance.alerts.alertId.acknowledge | Confirma a ciência do alerta. |
| Avisos | Criar ocorrência a partir do alerta | Operação | Não | access.post.maintenance.alerts.alertId.create_occurrence | Transforma um alerta em ocorrência rastreável. |
| Avisos | Consultar avisos | Consulta | Não | access.get.notifications | Consulta a central operacional persistente. |
| Avisos | Marcar aviso como lido | Operação | Não | access.patch.notifications.notificationId.read | Marca uma notificação como lida de forma persistente. |
| Avisos | Dispensar aviso | Arquivamento | Sim | access.patch.notifications.notificationId.dismiss | Dispensa uma notificação para o usuário atual. |
| Avisos | Marcar todos os avisos como lidos | Operação | Não | access.post.notifications.read_all | Marca todas as notificações visíveis como lidas. |
| Indicadores | Consultar indicadores técnicos | Consulta | Não | access.get.analytics.technical_summary | Calcula indicadores técnicos e ranking sem estimar OEE. |
| Revisão técnica | Consultar habilitação para revisão | Consulta | Não | access.get.workflow.technical_context | Consulta o escopo técnico e as capacidades do Gestor. |
| Revisão técnica | Consultar fila de revisão | Consulta | Não | access.get.workflow.technical_demands | Consulta somente demandas visíveis no escopo técnico atual. |
| Revisão técnica | Consultar pareceres técnicos | Consulta | Não | access.get.workflow.technical_reports | Consulta relatórios auditáveis da área técnica atual. |
| Revisão técnica | Assumir demanda de revisão | Operação | Não | access.post.workflow.technical_demands.demandId.assume | Assume uma demanda elegível sem alterar sua política de assinatura. |
| Ordens de serviço | Consultar ações de manutenção | Consulta | Não | access.get.maintenance.actions | Consulta ações ativas e concluídas para acompanhamento técnico. |
| Ordens de serviço | Consultar responsáveis disponíveis | Consulta | Não | access.get.maintenance.technicians | Lista técnicos ativos disponíveis para atribuição. |
| Ordens de serviço | Atribuir responsável | Atribuição | Não | access.put.maintenance.actions.actionId.assignment | Atribui uma ação pronta a um técnico ativo. |
| Ordens de serviço | Consultar detalhes de ações de manutenção | Consulta | Não | access.get.maintenance.actions.actionId | Consulta a ação, o checklist materializado e suas evidências. |
| Ordens de serviço | Revisar ações de manutenção | Revisão | Não | access.post.maintenance.actions.actionId.review | Aprova ou devolve uma execucao concluida pelo Operador. |
| Ordens de serviço | Solicitar justificativa de atraso | Operação | Não | access.post.maintenance.work_orders.workOrderId.followup | Solicita atualização ao responsável e ao executor da OS. |
| Ordens de serviço | Consultar ordens de serviço | Consulta | Não | access.get.maintenance.work_orders | Consulta a fila rastreável de ordens. |
| Ordens de serviço | Criar ordens de serviço | Cadastro | Não | access.post.maintenance.work_orders | Cria OS a partir de plano publicado. |
| Ordens de serviço | Consultar detalhes de ordens de serviço | Consulta | Não | access.get.maintenance.work_orders.workOrderId | Consulta OS, validação, assinaturas e ações. |
| Ordens de serviço | Consultar serviços externos da OS | Consulta | Não | access.get.maintenance.work_orders.workOrderId.external_services | Lista serviços externos e custos vinculados à OS. |
| Ordens de serviço | Registrar serviço externo | Operação | Não | access.post.maintenance.work_orders.workOrderId.external_services | Registra serviço externo sem criar usuário técnico artificial. |
| Materiais | Editar custo de material consumido | Edição | Não | access.patch.maintenance.material_usage.materialUsageId.cost | Complementa custo desconhecido de material com auditoria. |
| Melhorias | Consultar solicitações de melhoria | Consulta | Não | access.get.maintenance.improvement_requests | Lista solicitações de melhoria para avaliação do PCM. |
| Melhorias | Criar solicitações de melhoria | Cadastro | Não | access.post.maintenance.improvement_requests | Registra oportunidade de melhoria identificada pelo técnico. |
| Ordens de serviço | Editar ordens de serviço | Edição | Não | access.patch.maintenance.work_orders.workOrderId | Corrige uma OS devolvida e preserva a revisão anterior no histórico. |
| Ordens de serviço | Cancelar ordens de serviço | Cancelamento | Não | access.post.maintenance.work_orders.workOrderId.cancel | Cancela uma OS ainda em rascunho, preserva o histórico e libera sua ocorrência para nova OS. |
| Ordens de serviço | Solicitar revisão da OS | Revisão | Não | access.post.maintenance.work_orders.workOrderId.submit_review | Sela a OS e cria a demanda de validação. |
| Revisão técnica | Assinar demanda técnica | Assinatura | Sim | access.post.workflow.technical_demands.demandId.sign | Registra assinatura técnica permanente. |
| Revisão técnica | Solicitar correções | Revisão | Não | access.post.workflow.technical_demands.demandId.request_changes | Devolve a OS ao PCM com justificativa. |
| Ordens de serviço | Liberar ordem para execução | Liberação | Sim | access.post.maintenance.work_orders.workOrderId.release | Libera OS validada e cria a ação do Operador. |
| Execução técnica | Consultar trabalhos atribuídos | Consulta | Não | access.get.maintenance.operator_actions | Consulta somente ações executáveis e não concluídas. |
| Execução técnica | Consultar detalhes de trabalhos atribuídos | Consulta | Não | access.get.maintenance.operator_actions.actionId | Consulta o contexto executável da ação e seu checklist publicado. |
| Execução técnica | Consultar participantes da execução | Consulta | Não | access.get.maintenance.operator_actions.actionId.participants | Lista participantes e convites da execução. |
| Execução técnica | Convidar colaborador | Operação | Não | access.post.maintenance.operator_actions.actionId.collaborators | Convida técnico para colaborar na execução. |
| Execução técnica | Aceitar convite | Operação | Não | access.post.maintenance.operator_actions.actionId.collaborators.participantId.accept | Aceita convite para colaborar. |
| Execução técnica | Recusar convite | Operação | Não | access.post.maintenance.operator_actions.actionId.collaborators.participantId.decline | Recusa convite para colaborar. |
| Execução técnica | Iniciar execução | Operação | Não | access.post.maintenance.operator_actions.actionId.start | Assume e inicia a ação de forma atômica e idempotente. |
| Execução técnica | Preencher checklist | Operação | Não | access.put.maintenance.operator_actions.actionId.responses | Salva um lote de respostas de forma transacional. |
| Materiais | Consultar materiais para execução | Consulta | Não | access.get.maintenance.operator_actions.actionId.materials | Consulta materiais ativos para consumo na execução. |
| Materiais | Registrar consumo de material | Operação | Não | access.post.maintenance.operator_actions.actionId.materials | Baixa material do estoque e registra seu custo na OS. |
| Execução técnica | Conferir preenchimento da execução | Consulta | Não | access.get.maintenance.operator_actions.actionId.validation | Valida bloqueios da ação antes da conclusão. |
| Execução técnica | Concluir execução | Operação | Não | access.post.maintenance.operator_actions.actionId.complete | Conclui a ação do Operador após validar todos os bloqueios. |
| Execução técnica | Assumir trabalho | Operação | Não | access.post.maintenance.operator_actions.actionId.assume | Assume a ação e materializa o checklist publicado. |
| Execução técnica | Transferir execução para outro técnico | Atribuição | Não | access.post.maintenance.operator_actions.actionId.transfer | Transfere uma execução pausada para outro técnico da empresa. |
| Execução técnica | Consultar detalhes de execuções | Consulta | Não | access.get.maintenance.executions.executionId | Consulta execução e respostas materializadas. |
| Execução técnica | Conferir respostas e evidências | Consulta | Não | access.get.maintenance.executions.executionId.validation | Valida respostas e evidências antes da conclusão. |
| Execução técnica | Iniciar execução | Operação | Não | access.post.maintenance.executions.executionId.start | Inicia a execução atribuída. |
| Execução técnica | Pausar execução | Operação | Não | access.post.maintenance.executions.executionId.pause | Pausa uma execução em andamento e registra o motivo. |
| Execução técnica | Retomar execução | Operação | Não | access.post.maintenance.executions.executionId.resume | Retoma uma execução pausada sem contabilizar o tempo de pausa. |
| Ordens de serviço | Retomar execução | Operação | Não | access.post.maintenance.work_orders.workOrderId.executions.executionId.resume | PCM retoma execução dentro do escopo de planta. |
| Materiais | Consultar peças pendentes da execução | Consulta | Não | access.get.maintenance.executions.executionId.part_shortages | Lista pendências de peça visíveis à equipe da execução. |
| Materiais | Registrar falta de peça | Operação | Não | access.post.maintenance.executions.executionId.part_shortages | Registra falta de peça sem pausar automaticamente a OS. |
| Execução técnica | Registrar passagem de turno | Operação | Não | access.post.maintenance.executions.executionId.shift_handoffs | Registra passagem de turno e encerra somente a sessão do solicitante. |
| Materiais | Consultar peças pendentes da OS | Consulta | Não | access.get.maintenance.work_orders.workOrderId.part_shortages | Lista pendências de peça no escopo PCM. |
| Materiais | Consultar faltas de peças | Consulta | Não | access.get.maintenance.part_shortages | Lista pendências de peça visíveis no escopo PCM do usuário. |
| Materiais | Consultar detalhes de faltas de peças | Consulta | Não | access.get.maintenance.part_shortages.shortageId | Busca pendência de peça pelo ID no escopo de planta do PCM. |
| Materiais | Resolver pendência de peça | Operação | Não | access.post.maintenance.work_orders.workOrderId.part_shortages.shortageId.resolve | Resolve pendência de peça com justificativa auditável. |
| Materiais | Cancelar pendência de peça | Cancelamento | Não | access.post.maintenance.work_orders.workOrderId.part_shortages.shortageId.cancel | Cancela pendência de peça com justificativa auditável. |
| Execução técnica | Iniciar execução individual | Operação | Não | access.post.maintenance.executions.executionId.sessions.start | Inicia intervalo individual de trabalho. |
| Execução técnica | Pausar execução individual | Operação | Não | access.post.maintenance.executions.executionId.sessions.pause | Pausa somente o intervalo individual de trabalho. |
| Execução técnica | Retomar execução individual | Operação | Não | access.post.maintenance.executions.executionId.sessions.resume | Abre novo intervalo individual de trabalho. |
| Execução técnica | Encerrar sessão de execução individual | Operação | Não | access.post.maintenance.executions.executionId.sessions.end | Encerra o intervalo individual de trabalho. |
| Execução técnica | Responder etapa | Operação | Não | access.put.maintenance.executions.executionId.items.itemId.response | Registra e valida a resposta de uma etapa. |
| Execução técnica | Registrar evidência | Operação | Não | access.post.maintenance.executions.executionId.items.itemId.evidence | Vincula evidência previamente armazenada à etapa. |
| Execução técnica | Enviar arquivo de evidência | Operação | Não | access.post.maintenance.executions.executionId.items.itemId.evidence_file | Armazena uma foto privada e a vincula à etapa da execução. |
| Execução técnica | Consultar detalhes de evidências | Consulta | Não | access.get.maintenance.evidence_files.objectId | Lê uma evidência privada autorizada do tenant. |
| Execução técnica | Concluir execução | Operação | Não | access.post.maintenance.executions.executionId.complete | Conclui somente após validar respostas e evidências. |
| Checklists | Consultar tipos de etapas | Consulta | Não | access.get.maintenance.checklist_item_types | Consulta os nove tipos de resposta suportados. |
| Checklists | Consultar checklists | Consulta | Não | access.get.maintenance.checklists | Pesquisa modelos e a situação de sua revisão atual. |
| Checklists | Criar checklists | Cadastro | Não | access.post.maintenance.checklists | Cria um modelo com sua primeira revisão em rascunho. |
| Checklists | Consultar detalhes de checklists | Consulta | Não | access.get.maintenance.checklists.checklistId | Consulta modelo, revisões, etapas e pareceres técnicos. |
| Checklists | Editar checklists | Edição | Não | access.patch.maintenance.checklists.checklistId | Altera a identidade e a revisão editável do modelo. |
| Checklists | Adicionar etapa ao checklist | Edição | Não | access.post.maintenance.checklists.checklistId.items | Adiciona uma etapa validada ao rascunho. |
| Checklists | Editar etapa do checklist | Edição | Não | access.put.maintenance.checklists.checklistId.items.itemId | Substitui o conteúdo de uma etapa do rascunho. |
| Checklists | Remover etapa do checklist | Exclusão | Sim | access.delete.maintenance.checklists.checklistId.items.itemId | Remove uma etapa e recompõe a sequência. |
| Checklists | Reordenar etapas | Edição | Não | access.post.maintenance.checklists.checklistId.items.reorder | Reordena todas as etapas do rascunho atomicamente. |
| Checklists | Solicitar revisão do checklist | Revisão | Não | access.post.maintenance.checklists.checklistId.submit | Sela o conteúdo e o envia ao filtro técnico. |
| Checklists | Enviar checklist com opções de assinatura | Revisão | Não | access.post.maintenance.checklists.checklistId.submit_configured | Sela o checklist e registra a rota nominal de validação. |
| Checklists | Revisar checklists | Revisão | Não | access.post.maintenance.checklists.checklistId.review | Registra o parecer imutável do filtro técnico. |
| Checklists | Publicar checklists | Publicação | Sim | access.post.maintenance.checklists.checklistId.publish | Publica uma revisão aprovada sem alterar versões anteriores. |
| Checklists | Criar nova revisão do checklist | Edição | Não | access.post.maintenance.checklists.checklistId.revisions | Clona a revisão finalizada em um novo rascunho. |
| Checklists | Excluir rascunho de checklist | Exclusão | Sim | access.delete.maintenance.checklists.checklistId | Arquiva somente rascunhos sem histórico operacional. |
| Planos de manutenção | Consultar planos | Consulta | Não | access.get.maintenance.plans | Pesquisa planos programados e acionados por condição ou ocorrência. |
| Planos de manutenção | Criar planos | Cadastro | Não | access.post.maintenance.plans | Cria um plano vinculado a um checklist publicado. |
| Planos de manutenção | Consultar detalhe do plano | Consulta | Não | access.get.maintenance.plans.planId | Consulta o plano e todas as suas revisões. |
| Planos de manutenção | Editar planos | Edição | Não | access.patch.maintenance.plans.planId | Altera exclusivamente a revisão editável de um plano. |
| Planos de manutenção | Publicar planos | Publicação | Sim | access.post.maintenance.plans.planId.publish | Publica o plano após validar checklist, ativo e disparo. |
| Planos de manutenção | Criar nova revisão do plano | Edição | Não | access.post.maintenance.plans.planId.revisions | Clona um plano finalizado em uma revisão editável. |
| Áreas do sistema | Abrir acompanhamento | Navegação | Não | workspace.tracking.open | Abrir acompanhamento no portal, preservando as permissões de cada operação. |
| Áreas do sistema | Abrir manutenção | Navegação | Não | workspace.maintenance.open | Abrir manutenção no portal, preservando as permissões de cada operação. |
| Acompanhamento | Consultar fila de acompanhamento | Consulta | Não | access.get.pcm.tracking | Consultar fila de acompanhamento dentro do escopo de registros autorizado à conta. |
| Solicitações e histórico | Selecionar equipamentos para solicitação | Consulta | Não | access.get.shared.assets | Selecionar equipamentos para solicitação dentro do escopo de registros autorizado à conta. |
| Solicitações e histórico | Identificar equipamento da solicitação por código | Consulta | Não | access.get.shared.resolve_code | Identificar equipamento da solicitação por código dentro do escopo de registros autorizado à conta. |
| Solicitações e histórico | Criar solicitação | Cadastro | Não | access.post.shared.requests | Criar solicitação dentro do escopo de registros autorizado à conta. |
| Solicitações e histórico | Consultar solicitações | Consulta | Não | access.get.shared.requests | Consultar solicitações dentro do escopo de registros autorizado à conta. |
| Solicitações e histórico | Consultar detalhes de solicitação | Consulta | Não | access.get.shared.requests.id | Consultar detalhe de solicitação dentro do escopo de registros autorizado à conta. |
| Solicitações e histórico | Editar solicitação | Edição | Sim | access.put.shared.requests.id | Editar solicitação dentro do escopo de registros autorizado à conta. |
| Solicitações e histórico | Consultar histórico de ordens | Consulta | Não | access.get.shared.orders | Consultar histórico de ordens dentro do escopo de registros autorizado à conta. |
| Solicitações e histórico | Consultar detalhes da ordem no histórico | Consulta | Não | access.get.shared.orders.id | Consultar detalhe de ordem no histórico dentro do escopo de registros autorizado à conta. |
| Solicitações e histórico | Registrar observação na ordem | Operação | Sim | access.post.shared.orders.id.observations | Registrar observação na ordem dentro do escopo de registros autorizado à conta. |
| Estrutura | Ativar, desativar ou alterar situação de plantas | Situação | Não | access.patch.cmms.plants.plantId.status | Alterar a situação de plantas, sem permitir editar os demais dados ou arquivar registros. |
| Estrutura | Arquivar ou restaurar plantas | Arquivamento | Sim | access.patch.cmms.plants.plantId.archive | Arquivar ou restaurar plantas, preservando as restrições de vínculos e auditoria. Não concede edição dos demais dados. |
| Estrutura | Ativar, desativar ou alterar situação de setores | Situação | Não | access.patch.cmms.sectors.sectorId.status | Alterar a situação de setores, sem permitir editar os demais dados ou arquivar registros. |
| Estrutura | Arquivar ou restaurar setores | Arquivamento | Sim | access.patch.cmms.sectors.sectorId.archive | Arquivar ou restaurar setores, preservando as restrições de vínculos e auditoria. Não concede edição dos demais dados. |
| Estrutura | Ativar, desativar ou alterar situação de linhas | Situação | Não | access.patch.cmms.lines.lineId.status | Alterar a situação de linhas, sem permitir editar os demais dados ou arquivar registros. |
| Estrutura | Arquivar ou restaurar linhas | Arquivamento | Sim | access.patch.cmms.lines.lineId.archive | Arquivar ou restaurar linhas, preservando as restrições de vínculos e auditoria. Não concede edição dos demais dados. |
| Ativos e componentes | Ativar, desativar ou alterar situação de ativos | Situação | Não | access.patch.cmms.assets.assetId.status | Alterar a situação de ativos, sem permitir editar os demais dados ou arquivar registros. |
| Ativos e componentes | Arquivar ou restaurar ativos | Arquivamento | Sim | access.patch.cmms.assets.assetId.archive | Arquivar ou restaurar ativos, preservando as restrições de vínculos e auditoria. Não concede edição dos demais dados. |
| Ativos e componentes | Ativar, desativar ou alterar situação de componentes | Situação | Não | access.patch.cmms.components.componentId.status | Alterar a situação de componentes, sem permitir editar os demais dados ou arquivar registros. |
| Ativos e componentes | Arquivar ou restaurar componentes | Arquivamento | Sim | access.patch.cmms.components.componentId.archive | Arquivar ou restaurar componentes, preservando as restrições de vínculos e auditoria. Não concede edição dos demais dados. |
| Materiais | Ativar, desativar ou alterar situação de materiais | Situação | Não | access.patch.cmms.materials.materialId.status | Alterar a situação de materiais, sem permitir editar os demais dados ou arquivar registros. |
| Materiais | Arquivar ou restaurar materiais | Arquivamento | Sim | access.patch.cmms.materials.materialId.archive | Arquivar ou restaurar materiais, preservando as restrições de vínculos e auditoria. Não concede edição dos demais dados. |
| Materiais | Alterar saldo e mínimo de estoque | Estoque | Sim | access.patch.cmms.materials.materialId.stock | Alterar o saldo e o estoque mínimo de materiais, sem conceder alteração de custos ou dos demais dados. |
| Materiais | Alterar custo de materiais | Custos | Sim | access.patch.cmms.materials.materialId.cost | Alterar o custo unitário de materiais, sem conceder movimentação de saldo ou edição dos demais dados. |
| Planos de manutenção | Ativar, desativar ou alterar situação de planos de manutenção | Situação | Não | access.patch.maintenance.plans.planId.status | Alterar a situação de planos de manutenção, sem permitir editar os demais dados ou arquivar registros. |
| Planos de manutenção | Arquivar ou restaurar planos de manutenção | Arquivamento | Sim | access.patch.maintenance.plans.planId.archive | Arquivar ou restaurar planos de manutenção, preservando as restrições de vínculos e auditoria. Não concede edição dos demais dados. |
| Solicitações e histórico | Registrar acompanhamento de Qualidade | Operação | Não | maintenance.shared.observe.quality | Registrar observações de Qualidade na ordem, respeitando a habilitação técnica e o escopo da conta. Também exige a ação de registrar observação na ordem. |
| Solicitações e histórico | Registrar acompanhamento de Segurança | Operação | Não | maintenance.shared.observe.safety | Registrar observações de Segurança na ordem, respeitando a habilitação técnica e o escopo da conta. Também exige a ação de registrar observação na ordem. |
