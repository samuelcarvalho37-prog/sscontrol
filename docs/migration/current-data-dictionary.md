# Dicionário de dados atual — contrato 1.4.0

Fonte: `backend/apps-script/00_Config.js`

Quantidade declarada: 48 abas

Observação: este é o esquema declarado pela versão candidata. A existência e os cabeçalhos de cada aba devem ser confirmados em snapshot autenticado antes da migração.

## 1. config

`chave`, `valor`, `descricao`, `atualizado_em`

Chave primária lógica: `chave`.

## 2. usuarios

`id`, `nome`, `email`, `perfil`, `status`, `pin_hash`, `criado_em`, `atualizado_em`, `matricula`, `senha_hash`, `primeiro_acesso`, `tentativas_login`, `bloqueado_ate`, `ultimo_login_em`, `senha_atualizada_em`, `recuperacao_referencia`, `recuperacao_solicitada_em`, `area_id`, `cargo_id`, `especialidades_json`, `escopo_ids_json`

Chave: `id`. Relações: `area_id -> areas_tecnicas.id`; `cargo_id -> cargos_tecnicos.id`.

## 3. sessoes

`token`, `usuario_id`, `perfil`, `status`, `criado_em`, `expira_em`, `ultimo_uso_em`, `user_agent`, `escopo`, `expira_ms`, `revogado_em`, `motivo_revogacao`, `janela_id`, `ambiente`, `tenant_id`

Chave: `token`. Relação: `usuario_id -> usuarios.id`.

## 4. plantas

`id`, `tag`, `nome`, `status`, `criado_em`, `atualizado_em`

Chave: `id`. Único esperado: `tag`.

## 5. setores

`id`, `planta_id`, `tag`, `nome`, `status`, `criado_em`, `atualizado_em`

Chave: `id`. Relação: `planta_id -> plantas.id`.

## 6. linhas

`id`, `setor_id`, `tag`, `nome`, `status`, `criado_em`, `atualizado_em`

Chave: `id`. Relação: `setor_id -> setores.id`.

## 7. ativos

`id`, `linha_id`, `tag`, `qr_payload`, `nome`, `tipo`, `criticidade`, `status`, `saude_pct`, `horimetro_atual`, `fabricante`, `modelo`, `numero_serie`, `localizacao_tecnica`, `criado_em`, `atualizado_em`, `horimetro_modo`, `horimetro_atualizado_em`, `horimetro_base_servico`, `horimetro_base_servico_em`

Chave: `id`. Relação: `linha_id -> linhas.id`. Únicos esperados: `tag`, `qr_payload`.

## 8. componentes

`id`, `ativo_id`, `tag`, `qr_payload`, `nome`, `tipo`, `criticidade`, `status`, `vida_util_horas`, `vida_util_dias`, `horas_acumuladas`, `instalado_em`, `fabricante`, `modelo`, `numero_serie`, `localizacao_tecnica`, `criado_em`, `atualizado_em`

Chave: `id`. Relação: `ativo_id -> ativos.id`. Únicos esperados: `tag`, `qr_payload`.

## 9. materiais

`id`, `sku`, `nome`, `unidade`, `estoque_atual`, `estoque_minimo`, `status`, `criado_em`, `atualizado_em`

Chave: `id`. Único esperado: `sku`.

## 10. planos_manutencao

`id`, `ativo_id`, `componente_id`, `nome`, `tipo`, `criticidade`, `gatilho_tipo`, `gatilho_valor`, `unidade`, `recorrencia_dias`, `tempo_estimado_min`, `requer_bloqueio`, `requer_evidencia`, `max_sessoes`, `status`, `ultimo_disparo_em`, `criado_em`, `atualizado_em`, `workflow_status`, `validado_gestao`, `validado_por`, `validado_em`, `devolvido_por`, `devolvido_em`, `devolvido_motivo`, `enviado_validacao_em`, `revisao`, `setor_id`, `modelo_base_id`, `revisao_origem_id`, `substitui_plano_id`, `substituido_por`, `substituido_em`, `modo_parada_manutencao`, `analise_tecnica_json`, `analise_origem_id`, `ocorrencia_origem_id`

Chave: `id`. Relações: ativo, componente, setor, usuários validadores e autores, autorrelações de versão, análise e ocorrência.

## 11. plano_itens

`id`, `plano_id`, `ordem`, `titulo`, `instrucao`, `tipo_resposta`, `obrigatorio`, `evidencia_obrigatoria`, `foto_referencia_url`, `limite_min`, `limite_max`, `unidade`, `criado_em`, `atualizado_em`, `parametro_nome`, `valor_esperado`, `opcoes_json`, `bloqueia_finalizacao`, `categoria`, `peso`, `status`, `validacao_regra`, `evidencia_min_fotos`

Chave: `id`. Relação: `plano_id -> planos_manutencao.id`.

## 12. plano_controle

`plano_id`, `ativo_id`, `componente_id`, `gatilho_tipo`, `gatilho_valor`, `ultimo_valor_processado`, `proximo_valor_gatilho`, `ultima_acao_id`, `ultima_acao_status`, `atualizado_em`

Chave lógica: `plano_id`. Relações: plano, ativo, componente e ação.

## 13. ordens_servico

`id`, `codigo`, `ativo_id`, `componente_id`, `plano_id`, `origem`, `tipo`, `titulo`, `descricao`, `prioridade`, `status`, `solicitante_id`, `responsavel_id`, `aberta_em`, `planejada_para`, `iniciada_em`, `finalizada_em`, `criado_em`, `atualizado_em`, `modo_parada_manutencao`, `analise_tecnica_json`

Chave: `id`. Relações: ativo, componente, plano e usuários. Único esperado: `codigo`.

## 14. os_acoes

`id`, `os_id`, `ativo_id`, `componente_id`, `plano_id`, `origem`, `tipo`, `titulo`, `descricao`, `prioridade`, `status`, `responsavel_id`, `gerado_em`, `iniciado_em`, `finalizado_em`, `atualizado_em`, `modo_parada_manutencao`, `analise_tecnica_json`

Chave: `id`. Relações: OS, ativo, componente, plano e usuário.

## 15. execucoes

`id`, `acao_id`, `os_id`, `ativo_id`, `componente_id`, `operador_id`, `resultado`, `observacao`, `duracao_segundos`, `abriu_em`, `iniciou_em`, `finalizou_em`, `status`, `criado_em`, `atualizado_em`, `modo_execucao_manutencao`

Chave: `id`. Relações: ação, OS, ativo, componente e operador.

## 16. checklist_execucao

`id`, `execucao_id`, `acao_id`, `plano_item_id`, `ordem`, `titulo`, `instrucao`, `tipo_resposta`, `obrigatorio`, `resposta`, `observacao`, `evidencia_obrigatoria`, `status`, `responsavel_id`, `data_hora`, `criado_em`, `atualizado_em`, `parametro_nome`, `valor_esperado`, `opcoes_json`, `limite_min`, `limite_max`, `unidade`, `valor_numero`, `conforme`, `bloqueia_finalizacao`, `validacao_msg`, `evidencias_count`, `categoria`, `evidencia_min_fotos`

Chave: `id`. Relações: execução, ação, item do plano e usuário. Contém o snapshot da regra executada.

## 17. evidencias

`id`, `execucao_id`, `acao_id`, `checklist_execucao_id`, `ativo_id`, `componente_id`, `tipo`, `nome_arquivo`, `url`, `observacao`, `usuario_id`, `criado_em`, `arquivo_id`, `mime_type`, `tamanho_bytes`, `thumbnail_url`

Chave: `id`. Relações: execução, ação, item executado, ativo, componente, usuário e arquivo no Drive.

## 18. materiais_uso

`id`, `execucao_id`, `acao_id`, `material_id`, `quantidade`, `unidade`, `observacao`, `usuario_id`, `criado_em`

Chave: `id`. Relações: execução, ação, material e usuário.

## 19. parametros

`id`, `ativo_id`, `componente_id`, `parametro`, `valor`, `unidade`, `origem`, `registrado_por`, `registrado_em`, `criado_em`

Chave: `id`. Relações: ativo, componente opcional e usuário.

## 20. paradas_equipamento

`id`, `ativo_id`, `componente_id`, `os_id`, `acao_id`, `execucao_id`, `origem`, `tipo`, `status`, `iniciada_em`, `iniciada_por`, `manutencao_iniciada_em`, `manutencao_finalizada_em`, `finalizada_em`, `finalizada_por`, `tempo_parada_segundos`, `tempo_espera_manutencao_segundos`, `tempo_execucao_segundos`, `tempo_retorno_operacional_segundos`, `motivo_parada`, `categoria_retorno`, `justificativa_divergencia`, `tolerancia_retorno_min`, `criado_em`, `atualizado_em`

Chave: `id`. Relações: ativo, componente, OS, ação, execução e usuários.

## 21. paradas_manutencao

`id`, `ativo_id`, `componente_id`, `os_id`, `acao_id`, `execucao_id`, `modo_configurado`, `decisao_execucao`, `status`, `equipamento_ja_parado`, `alterou_status_ativo`, `iniciada_em`, `finalizada_em`, `duracao_segundos`, `usuario_id`, `criado_em`, `atualizado_em`

Chave: `id`. Relações: ativo, componente, OS, ação, execução e usuário.

## 22. ocorrencias_operacionais

`id`, `ativo_id`, `componente_id`, `tipo`, `titulo`, `descricao`, `severidade`, `status`, `usuario_id`, `perfil`, `os_id`, `acao_id`, `parada_id`, `demanda_tecnica_id`, `analise_tecnica_id`, `tratamento_status`, `criado_em`, `atualizado_em`

Chave: `id`. Relações: ativo, componente, usuário, OS, ação, parada, demanda e análise.

## 23. areas_tecnicas

`id`, `codigo`, `nome`, `descricao`, `status`, `exige_assinatura_padrao`, `criado_por`, `criado_em`, `atualizado_em`

Chave: `id`. Relação: `criado_por -> usuarios.id`. Único esperado: `codigo`.

## 24. cargos_tecnicos

`id`, `area_id`, `codigo`, `nome`, `descricao`, `status`, `pode_assinar`, `criado_por`, `criado_em`, `atualizado_em`

Chave: `id`. Relações: área e usuário criador. Único esperado: `codigo` dentro da área.

## 25. demandas_tecnicas

`id`, `tipo`, `entidade_tipo`, `entidade_id`, `origem_tipo`, `origem_id`, `titulo`, `descricao`, `prioridade`, `status`, `area_origem_id`, `area_atual_id`, `cargo_atual_id`, `responsavel_atual_id`, `criado_por`, `criado_perfil`, `exige_assinatura`, `assinaturas_necessarias`, `assinaturas_realizadas`, `exige_segregacao`, `politica_assinatura`, `areas_validadoras_json`, `usuarios_validadores_json`, `prazo_primeira_resposta_em`, `prazo_resolucao_em`, `primeiro_atendimento_em`, `concluido_em`, `versao_entidade`, `payload_hash`, `criado_em`, `atualizado_em`

Chave: `id`. Relações: entidade e origem polimórficas, áreas, cargo e usuários.

## 26. demanda_tramitacoes

`id`, `demanda_id`, `sequencia`, `acao`, `de_area_id`, `de_cargo_id`, `de_usuario_id`, `para_area_id`, `para_cargo_id`, `para_usuario_id`, `decisao`, `parecer`, `motivo`, `payload_hash`, `criado_em`

Chave: `id`. Relações: demanda, áreas, cargos e usuários.

## 27. assinaturas_tecnicas

`id`, `demanda_id`, `entidade_tipo`, `entidade_id`, `versao_entidade`, `usuario_id`, `perfil`, `area_id`, `cargo_id`, `significado`, `declaracao`, `payload_hash`, `criado_em`, `revogado_em`, `motivo_revogacao`

Chave: `id`. Relações: demanda, entidade polimórfica, usuário, área e cargo. Identidade lógica: entidade + versão + usuário + hash.

## 28. analises_tecnicas

`id`, `demanda_id`, `ocorrencia_id`, `ativo_id`, `componente_id`, `autor_id`, `area_id`, `cargo_id`, `titulo`, `diagnostico`, `risco`, `causa_provavel`, `recomendacao`, `recomenda_checklist`, `recomenda_os`, `prioridade`, `status`, `enviado_admin_em`, `criado_em`, `atualizado_em`, `relatorio_tecnico_json`

Chave: `id`. Relações: demanda, ocorrência, ativo, componente, usuário, área e cargo.

## 29. notificacoes

`id`, `usuario_id`, `perfil`, `area_id`, `tipo`, `titulo`, `mensagem`, `entidade_tipo`, `entidade_id`, `prioridade`, `status`, `lida_em`, `criado_em`

Chave: `id`. Relações: usuário, área e entidade polimórfica.

## 30. turnos

`id`, `planta_id`, `setor_id`, `linha_id`, `nome`, `inicio_hora`, `fim_hora`, `dias_semana_json`, `timezone`, `status`, `criado_em`, `atualizado_em`

Chave: `id`. Relações: planta, setor e linha.

## 31. apontamentos_producao

`id`, `turno_id`, `ativo_id`, `inicio_em`, `fim_em`, `tempo_planejado_segundos`, `tempo_operacao_segundos`, `ciclo_ideal_segundos`, `quantidade_total`, `quantidade_boas`, `quantidade_refugo`, `fonte`, `usuario_id`, `criado_em`, `atualizado_em`

Chave: `id`. Relações: turno, ativo e usuário. Fonte necessária para OEE.

## 32. sla_politicas

`id`, `tipo_demanda`, `prioridade`, `area_id`, `resposta_minutos`, `resolucao_minutos`, `calendario_id`, `status`, `criado_em`, `atualizado_em`

Chave: `id`. Relação: área. Lacuna: não há entidade de calendário declarada.

## 33. historico

`id`, `ativo_id`, `componente_id`, `os_id`, `acao_id`, `execucao_id`, `evento`, `descricao`, `usuario_id`, `perfil`, `criado_em`

Chave: `id`. Relações: ativo, componente, OS, ação, execução e usuário.

## 34. execucao_locks

`id`, `ativo_id`, `acao_id`, `usuario_id`, `sessao_id`, `status`, `adquirido_em`, `ultimo_ping_em`, `expira_em`, `liberado_em`, `motivo_liberacao`, `user_agent`

Chave: `id`. Relações: ativo, ação, usuário e sessão.

## 35. telemetria_sessoes

`id`, `sessao_id`, `usuario_id`, `ativo_id`, `acao_id`, `evento`, `visibilidade`, `delta_segundos`, `tempo_total_segundos`, `tempo_visivel_segundos`, `tempo_oculto_segundos`, `user_agent`, `criado_em`

Chave: `id`. Relações: sessão, usuário, ativo e ação.

## 36. audit_log

`id`, `usuario_id`, `perfil`, `acao`, `entidade`, `entidade_id`, `antes_json`, `depois_json`, `user_agent`, `criado_em`

Chave: `id`. Relação: usuário e entidade lógica. Deve permanecer imutável.

## 37. checklist_modelo_validacoes

`id`, `plano_id`, `revisao`, `decisao`, `justificativa`, `usuario_id`, `perfil`, `criado_em`

Chave: `id`. Relações: plano e usuário.

## 38. checklist_tipos_item

`id`, `tipo`, `nome`, `descricao`, `requer_resposta`, `requer_valor`, `requer_opcoes`, `suporta_limite`, `suporta_evidencia`, `categoria_padrao`, `ativo`, `criado_em`

Chave: `id`. Único esperado: `tipo`.

## 39. checklist_validacao_regras

`id`, `tipo_item`, `codigo`, `nome`, `descricao`, `regra_json`, `ativo`, `criado_em`

Chave: `id`. Relação lógica: `tipo_item -> checklist_tipos_item.tipo`.

## 40. modelo_checklist_auditoria

`id`, `plano_id`, `item_id`, `evento`, `antes_json`, `depois_json`, `usuario_id`, `perfil`, `criado_em`

Chave: `id`. Relações: plano, item e usuário.

## 41. dashboard_cache

`chave`, `valor_json`, `gerado_em`, `ttl_segundos`

Chave: `chave`. Cache derivado; não é fonte de verdade.

## 42. configuracao_versoes

`id`, `numero`, `status`, `origem`, `base_versao_id`, `configuracao_json`, `hash_sha256`, `validacao_json`, `criado_por`, `criado_em`

Chave: `id`. Relações: versão-base e usuário.

## 43. configuracao_rascunhos

`id`, `usuario_id`, `base_versao_id`, `configuracao_json`, `hash_sha256`, `validacao_json`, `status`, `criado_em`, `atualizado_em`

Chave: `id`. Relações: usuário e versão-base.

## 44. importacao_lotes

`id`, `tipo`, `entidade`, `arquivo_nome`, `aba_nome`, `status`, `total_linhas`, `linhas_validas`, `linhas_invalidas`, `validacao_hash`, `cabecalhos_json`, `cabecalhos_ignorados_json`, `resultado_json`, `criado_por`, `criado_em`, `confirmado_por`, `confirmado_em`, `rollback_por`, `rollback_em`, `atualizado_em`

Chave: `id`. Relações: usuários de criação, confirmação e rollback.

## 45. importacao_registros

`id`, `lote_id`, `linha_numero`, `entidade`, `entidade_id`, `operacao`, `status`, `raw_json`, `normalizado_json`, `erros_json`, `antes_json`, `depois_json`, `aplicado_em`, `rollback_em`, `criado_em`, `atualizado_em`

Chave: `id`. Relação: `lote_id -> importacao_lotes.id`.

## 46. documentos_tecnicos

`id`, `codigo`, `titulo`, `tipo`, `entidade_tipo`, `entidade_id`, `status`, `revisao_atual`, `validade_em`, `responsavel_id`, `descricao`, `arquivo_id`, `arquivo_nome`, `mime_type`, `tamanho_bytes`, `criado_por`, `criado_em`, `atualizado_em`

Chave: `id`. Relações: entidade polimórfica, responsável, criador e arquivo no Drive.

## 47. documento_revisoes

`id`, `documento_id`, `revisao`, `arquivo_id`, `arquivo_nome`, `mime_type`, `tamanho_bytes`, `observacao`, `criado_por`, `criado_em`

Chave: `id`. Relações: documento, usuário e arquivo no Drive.

## 48. legado_quarentena

`id`, `aba_origem`, `linha_origem`, `motivo`, `payload_json`, `movido_em`

Chave: `id`. Preserva registros incompatíveis sem descartá-los.

## Regras de migração derivadas

- IDs atuais devem ser preservados como identificadores legados, mesmo que o novo banco adote UUID.
- Datas devem ser convertidas usando `America/Sao_Paulo`, sem perder o valor original.
- Status devem ser migrados por enumeração explícita, nunca por texto livre silencioso.
- Campos JSON devem ser validados contra um esquema antes da inserção.
- Registros órfãos devem ir para quarentena, não ser apagados.
- `dashboard_cache` pode ser regenerado depois da migração.
- sessões ativas serão arquivadas, mas não aceitas pelo novo backend.
- arquivos do Drive devem ser reconciliados separadamente.
- assinaturas exigem preservação de `versao_entidade` e `payload_hash`.
- histórico e auditoria não podem ser reescritos.
