# Rodada 3 — Relatório técnico da execução

## Estrutura existente

A conferência do schema confirmou que `maintenance.executions` possui `result` e `observation`, sem campos separados de diagnóstico e ação. O banco já registra consumo em `maintenance.material_usage` e leituras em `cmms.parameter_readings`; estas últimas também são geradas pelas respostas técnicas do checklist. Esses registros não foram substituídos nem duplicados em novas tabelas.

## Mudanças

A finalização operacional recebe quatro campos distintos: diagnóstico técnico, ação realizada, peças/materiais utilizados e medições. O formulário solicita quantidades e unidades no relato; ausência de material ou medição deve ser informada explicitamente. O rascunho técnico é mantido em sessionStorage por execução e removido após a conclusão. O resumo de uma execução concluída apresenta os quatro campos separadamente.

O relato textual complementa o consumo e as leituras estruturadas existentes. Preencher o relato não realiza baixa automática de estoque nem cria uma leitura numérica de parâmetro.

## Persistência e compatibilidade

Sem migration nova. Os endpoints existentes de conclusão aceitam o objeto opcional `relatorio_tecnico`, com quatro propriedades próprias. Clientes anteriores permanecem compatíveis. O objeto é salvo em `maintenance.history_events`, evento imutável `EXECUTION_TECHNICAL_REPORT`, com tenant, ativo, ordem, ação, execução e usuário responsável, na mesma transação da conclusão. A consulta da execução devolve o relatório.

As verificações de propriedade da execução, capability, situação, respostas obrigatórias e evidências continuam antes de qualquer gravação. A RLS e as chaves compostas existentes continuam protegendo o histórico.

## Verificação

O teste integrado de execução inclui um relatório com diagnóstico, ação, materiais e medição e verifica sua recuperação após concluir. Mantém as verificações anteriores de conclusão bloqueada, evidências e leitura de parâmetro gerada pelo checklist.

Rodada concluída: typecheck do backend e frontend operacional, build operacional e suíte completa aprovados. `npm test`: 19 testes, zero falhas, cancelamentos e testes pulados. Log local: `results-1788965428139.log`.
