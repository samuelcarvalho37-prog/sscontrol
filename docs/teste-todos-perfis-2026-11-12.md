# Teste integrado dos perfis — 12/11/2026

Resultado: 17 testes integrados passaram, sem falhas. A suíte de frontend passou com 60 testes. Builds de gestor e operador passaram; permanece o aviso conhecido de tamanho do bundle do gestor.

## Ambiente e método

Backup da homologação realizado antes da execução. Cópia descartável `vorqix_shared_test_20261112_185617` restaurada a partir desse backup. As solicitações, OS, execuções, acompanhamentos, assinaturas e mudanças temporárias de escopo dos testes foram gravadas somente nessa cópia. Nenhuma OS existente da homologação foi executada ou alterada pelos testes.

Os ciclos usaram o servidor real da aplicação via Fastify inject, com autenticação e autorização, transações PostgreSQL e dados da cópia. Não foram mocks de serviços. A execução temporária está registrada no log local `work/homologacao/all-profiles-flow.log` do ambiente de preparação; não contém credenciais. A suíte complementar temporária reutilizou o teste integrado versionado e acrescentou ciclos por solicitante.

## Matriz operacional

| Solicitante | Executor do ciclo | Resultado |
|---|---|---|
| Operador | Manutenção | Concluído com PCM e duas assinaturas finais |
| Produção | Mecânico | Concluído com PCM e duas assinaturas finais |
| Manutenção | Elétrica | Concluído com PCM e duas assinaturas finais |
| Mecânico | Mecânico | Concluído com PCM e duas assinaturas finais |
| Elétrica | Mecânico | Concluído com PCM e duas assinaturas finais |
| Qualidade | Elétrica | Concluído com PCM e duas assinaturas finais |
| Segurança | Manutenção | Concluído com PCM e duas assinaturas finais |
| PCM | Mecânico | Concluído com PCM e duas assinaturas finais |

Em cada ciclo, o PCM criou a OS a partir da solicitação e de plano publicado, confirmou as exigências e liberou; o técnico assumiu e iniciou, respondeu o checklist e concluiu tecnicamente; Qualidade e Segurança registraram acompanhamento e assinaram. Uma assinatura não encerrou a OS quando ambas eram exigidas. Todos os perfis operacionais consultaram os detalhes e o encerramento.

TI autenticou, mas permaneceu sem acesso ao painel operacional compartilhado, conforme a separação de funções. Não foi feita uma homologação completa de todos os módulos administrativos do TI.

Também passaram: idempotência, recusa de criação direta fora do PCM, devolução/correção pelo solicitante, rejeição, indicação de validação, resolução de QR, seleção hierárquica, triagem, prioridade, ausência de parada automática, acompanhamento separado da assinatura e negações por unidade/tenant.

## Problema encontrado e corrigido

No navegador, o Operador entrava na fila de validação porque possuía leitura de OS. Essa leitura não concedia permissão para validar, e a tela exibia erro de autorização. A página inicial agora apresenta o painel compartilhado para perfis operacionais sem capacidade de revisão; técnicos, PCM, Qualidade/Segurança revisores e TI mantêm suas experiências próprias. Não houve concessão de permissões novas.

A correção tem teste de regressão para Operador/Produção com leitura de OS e para a preservação das telas dos demais perfis. A entrada do Operador foi conferida novamente no navegador, com exibição da consulta e sem erro de validação.

## Limites do resultado

Os ciclos completos de todos os perfis foram automatizados na API/banco; a conferência desta rodada no navegador cobriu reconexão, login e página inicial do Operador. Não se declara execução manual de todas as telas de todos os perfis.

Continuam pendentes câmera e captura/envio/reabertura de foto em iPhone/tablet físicos na origem HTTPS e o aceite final acompanhado do usuário. O resultado não equivale a implantação em produção ou homologação global de todos os módulos.
