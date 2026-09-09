# Rodada 2 — Ocorrência guiada de Produção

## Mudanças

Formulário compartilhado pelos dois frontends: setor, linha, equipamento, problema, situação atual, seis perguntas sim/não, prioridade sugerida, descrição/foto e revisão antes do envio. Produção o recebe na página inicial pelas capabilities de relato e ausência das capabilities de execução/ordens. O formulário consulta estrutura ativa e equipamentos ativos da linha, incluindo todas as páginas do catálogo.

## Contrato

O POST existente de ocorrências aceita os campos opcionais `triagem` e `foto`; clientes antigos continuam válidos. A API recalcula a severidade quando recebe triagem e usa a resposta de equipamento parado para a abertura/vinculação da parada existente.

- CRITICAL: risco de segurança, ou equipamento parado com impacto produtivo sem redundância.
- HIGH: equipamento parado, impacto na qualidade, ou risco de parada sem redundância.
- MEDIUM: demais casos de risco de parada ou impacto produtivo.
- LOW: nenhum dos fatores anteriores.

Redundância não reduz prioridade por risco de segurança ou qualidade. A regra é identificada como `v1` no histórico para rastreabilidade.

## Persistência e isolamento

Sem migration. Respostas e foto ficam no JSON do evento imutável `OCCURRENCE_REPORTED` em `maintenance.history_events`, associado à ocorrência pelo identificador e ao ativo/tenant pelos vínculos existentes. O GET autenticado da ocorrência expõe `relato_producao`. A consulta correlaciona explicitamente tenant, ativo e ocorrência, além da RLS existente. Nenhuma capability foi adicionada à Produção.

A imagem é uma foto de referência JPEG: o navegador reduz para até 1280 pixels e aproximadamente 300 KB, removendo os metadados originais ao desenhar no canvas. A API limita o tamanho e verifica assinatura JPEG. A imagem não recebe URL pública nem é incluída nas listas de ocorrências. Não é um armazenamento de originais fotográficos.

## Verificação

Teste de prioridade cobre segurança, qualidade, parada e redundância. O teste de integração de monitoramento envia prioridade e condição de parada conflitantes com a triagem e verifica o cálculo do servidor e a recuperação das respostas pelo GET da ocorrência.

Rodada validada: typecheck do backend e dos frontends, builds dos dois frontends e suíte completa `npm test` passaram. Foram 19 testes, zero falhas, cancelamentos ou testes pulados. Log local: `results-1788944981503.log`.
