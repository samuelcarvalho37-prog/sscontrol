# Rodada 4 — Qualidade e Segurança por exceção

## Regra

Novas demandas de liberação são exigidas somente quando a OS é PREVENTIVE, possui programação, usa plano com MANDATORY_STOP e tem `analise_tecnica.exige_liberacao_pos_intervencao=true`. Corretivas, inspeções, preventivas sem programação e atividades sem a opção explícita não geram exigência de Qualidade/Segurança.

## Fluxo

A execução é liberada primeiro. Nas exceções, a demanda `POST_INTERVENTION_RELEASE` e seus requisitos ficam preparados em OPEN. Assinaturas são recusadas até a conclusão técnica. A conclusão abre AWAITING_SIGNATURE e vincula o hash do conteúdo da execução à demanda. A última assinatura conclui a ordem e a ação existente, sem gerar uma segunda ação.

A aprovação genérica da ação não dispensa as assinaturas. O retorno de um equipamento com intervenção pendente de liberação também é bloqueado. As demandas anteriores mantêm seus tipos, assinaturas e comportamento de compatibilidade; não há conversão destrutiva de histórico.

## Interface e banco

A edição da intervenção oferece a opção explícita de liberação pós-intervenção para preventivas programadas. A escolha dos validadores passa a configurar a liberação posterior. A estrutura existente `workflow.demand_validator_requirements` é reutilizada, incluindo requisito alternativo para Qualidade ou Segurança. Nenhuma tabela, papel ou capability nova.

A migration `0018_post_intervention_release.sql` ajusta o gatilho de liberação da OS: a regra da migration 0011 exigia demanda assinada em todas as atividades e impedia o novo fluxo. O ajuste mantém as verificações de plano/checklist publicados e conteúdo selado, permite atividades comuns sem demanda e prepara os requisitos das exceções antes da execução. Um gatilho adicional impede concluir a OS enquanto a liberação posterior estiver pendente. As funções continuam sujeitas ao contexto de tenant e RLS.

## Verificação

Testes cobrem a condição da exceção, recusa de assinatura antecipada, assinatura após execução, ausência de nova ação ao liberar e atividades comuns sem exigência de validação. A migration foi aplicada primeiro no banco isolado; os dois testes específicos passaram. Depois foi aplicada ao banco local de desenvolvimento e uma nova cópia de schema foi preparada para a suíte completa: `npm test`, 20 testes aprovados, zero falhas/cancelados/pulados (`results-1789006108834.log`). Typecheck dos três projetos e builds dos dois frontends passaram, incluindo a compilação final da gestão após o ajuste do aviso de roteamento.

## Correção do acesso à prévia

O teste HTTP real identificou `CORS_ORIGIN_DENIED` ao entrar pelo endereço local na porta 5178. A origem exata foi incluída na configuração local e no `.env.example`, mantendo a lista explícita. Os dois logins passam a distinguir esse erro de uma credencial inválida. Os sete logins foram reconfirmados pela API e o login ADMIN foi verificado pelo navegador. A tela administrativa exige largura mínima de 901 px.
