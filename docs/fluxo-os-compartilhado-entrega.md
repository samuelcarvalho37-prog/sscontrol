# Solicitação e acompanhamento compartilhado de OS

Entrega de 12/11/2026 na branch `qa/homologacao-integrada-20261031`.

## Comportamento entregue

- Perfis operacionais recebem Solicitar OS e consulta das solicitações e ordens no escopo de unidade atribuído ao usuário. TI não recebe essas capacidades.
- Pedido é uma solicitação, não uma OS liberada. O PCM pode devolver para correção pelo solicitante, recusar com motivo ou criar uma OS com roteiro publicado e liberar a execução.
- Reenvio idempotente não duplica pedido. Solicitação recusada ou devolvida não pode gerar OS. O vínculo com OS permanece único.
- Solicitante indica Qualidade/Segurança; o PCM confirma as áreas. Alteração da indicação exige justificativa. A política persistida é respeitada pelo servidor.
- Qualidade e Segurança da unidade recebem avisos transacionais de liberação e início. Acompanhamento é registrado com área, pessoa, horário e observação, separado da assinatura final.
- Ausência de acompanhamento não bloqueia o início pelo técnico de OS liberada. Regras de execução, elegibilidade e LOTO existentes são preservadas.
- Conclusão técnica aguarda as assinaturas exigidas antes do encerramento. Duas áreas exigidas demandam duas assinaturas.
- Painel compartilhado mostra solicitante, PCM responsável pela criação da OS, responsável designado, executor, local, programação, início, conclusão técnica, encerramento, observações e assinaturas válidas. Não expõe hashes de assinatura.

## Atualização em outro ambiente

1. Salvar alterações locais e obter esta branch pelo Git, sem forçar sobrescrita.
2. Fazer backup do banco e evidências do ambiente de destino.
3. No backend, usar as configurações locais já existentes, executar `npm run db:migrate` e `npm run build`; reiniciar a API. A migração aditiva nova é `0061_shared_work_requests.sql`. Não editar migrações históricas nem reexecutar seed em um banco com dados a preservar.
4. Compilar os dois frontends com `npm run build` e atualizar os processos/artefatos conforme a execução local.
5. Sair e entrar novamente nos perfis para atualizar as capacidades da sessão no navegador.
6. Conferir os vínculos de unidade dos usuários operacionais pelo mecanismo de administração existente. A atualização não atribui automaticamente escopo global a usuários reais. O seed de ambientes novos vincula somente as identidades fictícias à planta de demonstração.

Na homologação local, a migração foi aplicada após backup. Sete identidades fictícias que não tinham vínculo receberam a mesma planta de homologação já atribuída ao PCM, com evento de auditoria. Nenhuma senha foi alterada. Banco de desenvolvimento preservado.

## Verificação

- Typecheck e build do backend passaram.
- Build dos frontends operador e gestor passou. Gestor mantém aviso de tamanho de bundle.
- 57 testes de frontend passaram.
- Suíte padrão backend: 28 passaram; 23 integrações condicionais foram ignoradas por ausência de configuração específica, sem falhas.
- Integração específica em cópia descartável: 9 testes passaram, incluindo oito perfis operacionais, TI negado, idempotência, devolução/correção, rejeição, conversão única, início sem presença, notificações, acompanhamento por área, duas assinaturas e isolamento de escopo/tenant.
- Migração conferida também em cópia restaurada antes de aplicar na homologação.

Executar a integração específica exige `SHARED_TEST_ADMIN_URL`, `DATABASE_URL` e as variáveis de credenciais fictícias do ambiente, mantidas fora do Git. O teste recusa bancos cujo nome não siga `vorqix_shared_test_YYYYMMDD_HHMMSS` e exige que ambas as URLs apontem à mesma cópia. Ele altera somente essa cópia de teste.

## Aceite restante

A revisão visual acompanhada de cada perfil e a captura/envio/reabertura de foto real no iPhone continuam como aceite do usuário. A sessão antiga do navegador precisa de novo login para carregar as capacidades novas. Esta entrega não declara homologação global nem implantação em produção concluídas.
