# Validação final local VORQIX — 01/11/2026

Situação: verificações técnicas desta rodada concluídas; candidato ao aceite operacional local. Não é aprovação para produção ou aceite em nome dos responsáveis.

## Resultado por etapa

| Etapa | Resultado e evidência |
|---|---|
| Conferência visual de manutenção externa | OS-00000009 exibiu modo Externa, dois prestadores e total de R$ 1.700,00. O formulário de serviço foi exercitado na OS-00000011 com prestador fictício e R$ 123,45, confirmado pela interface e auditoria. |
| Conferência visual de estoque | OS-00000010 exibiu 1 UN de ROL-6205-2RS, R$ 75,90 unitário/total e conclusão com Qualidade e Segurança; o painel mostrou saldo 1 UN. O lançamento do consumo pelo técnico foi testado anteriormente pela API; esta rodada conferiu a apresentação no PCM. |
| Indisponibilidade durante preenchimento | Somente a API de homologação 3334 foi interrompida antes do envio. O formulário preservou plano, título, descrição e modo Externa e exibiu erro compreensível. Após reinício, o reenvio criou exatamente uma OS, a OS-00000011. Não foi simulado pacote de resposta perdido após confirmação no servidor. |
| Cancelamento visual | OS-00000011 cancelada como rascunho com justificativa. Texto curto manteve confirmação desabilitada; histórico e serviço fictício permaneceram preservados, sem execução ou pagamento. |
| Devolução e correção | Qualidade devolveu a OS-00000012 ao PCM. O conteúdo foi corrigido, uma nova demanda foi criada e o histórico da demanda anterior permaneceu CHANGES_REQUESTED. |
| Bloqueio de peça | Uma falta fictícia impeditiva bloqueou conclusão e retomada. A regra exigiu vínculo de planta do PCM para receber e resolver a pendência. |
| Troca de técnico | Transferência sem pausa foi recusada. Após pausa, a execução foi transferida do mecânico para Tec Elétrica e permaneceu pausada. O novo técnico retomou após a resolução da peça; o técnico anterior não pôde concluir. |
| Encerramento | OS-00000012 concluída por Tec Elétrica, com evidência simulada e assinaturas de Qualidade e Segurança; pendência RESOLVED. Nenhum consumo adicional de estoque. |

Os testes de exceção da OS 12 foram feitos pelos endpoints oficiais autenticados, e o encerramento foi conferido visualmente no PCM. Não se afirma que todas as telas de todos os perfis foram novamente percorridas nesta rodada.

## Correção do produto

O cancelamento estava oculto e a ação retornava sem enviar a solicitação quando o adaptador fornecia RASCUNHO. A tela verificava apenas DRAFT. Visibilidade e ação agora usam uma mesma regra que reconhece ambos os formatos; ordens liberadas, concluídas e canceladas não recebem essa ação. Foi adicionada regressão para os dois estados de rascunho e estados inelegíveis, e o cancelamento real foi verificado pela interface.

## Configuração de segurança autorizada

A massa de homologação não possuía escopo de planta para USR-PCM-DEMO. Sem isso, a aplicação corretamente impedia visualizar e tratar faltas de peça. Com autorização explícita do usuário nesta conversa, foi criado somente um vínculo PLANT para “Unidade Industrial de Homologação”, no banco vorqix_hml_20261031_185851, com evento de auditoria HOMOLOGATION_PCM_PLANT_SCOPE_ASSIGNED. Nenhum vínculo TENANT, nova capacidade global ou usuário real foi alterado. As regras de acesso do produto permaneceram intactas.

O vínculo é dado desse banco, preservado no backup; não é um novo privilégio global embutido no código ou no seed. Ao provisionar outra instalação, configure o escopo de planta do PCM antes de usar o fluxo de peças. O ZIP de código não transporta esse banco nem credenciais.

## Regressão e recuperação

- API: 41 testes aprovados, zero falhas ou ignorados, em banco separado fab_control_node_test_*.
- Frontend: 44 testes aprovados, zero falhas ou ignorados, incluindo a nova regressão do cancelamento.
- Contratos de acesso e inicialização: 8 testes aprovados.
- Total desta rodada: 93 testes automatizados, além de 15 verificações do cenário de exceções e das conferências visuais.
- Verificação TypeScript e build do frontend aprovados. O aviso existente de chunks acima de 500 kB permanece.
- Backup 20261101_091146 restaurado em banco novo, com origem preservada: 9 usuários, 12 ordens, 6 execuções, 12 evidências, 3 ocorrências, 1 plano comercial e 14 assinaturas.
- A leitura adicional da restauração confirmou o vínculo de planta autorizado, OS 12 COMPLETED, demanda antiga CHANGES_REQUESTED e estoque do rolamento em 1 UN.
- APIs de desenvolvimento (3333) e homologação (3334) saudáveis ao finalizar. Não foram alterados registros de vorqix_dev.

## Evidências locais

Capturas em outputs: Validacao-externa-visual-20261101.png, Validacao-estoque-custos-20261101.png, Validacao-interrupcao-formulario-20261101.png, Validacao-cancelamento-visual-20261101.png e Validacao-excecoes-concluidas-20261101.png.

Logs e resultados sanitizados em work/homologacao: regressao-final-20261101-api.log, regressao-final-20261101-front-corrigido.log, regressao-final-20261101-contratos.log, regressao-final-20261101-build-corrigido.log, excecoes-*.log e excecoes-resultado.json. Backups e DPAPI ficam privados nessa pasta e não integram o pacote de fonte.

## Aceite ainda necessário

Os responsáveis de Produção, PCM, manutenção, Qualidade, Segurança, TI e Plataforma devem realizar e assinar o piloto do roteiro Entrega-local-VORQIX.md. Permanecem pendentes celular físico, câmera/QR, fotos reais autorizadas e impressão. Não foram homologados compras, nota fiscal, pagamento, reposição/devolução de estoque ou contingência de rede física. O selo Online indica conectividade, não presença do técnico em tempo real.

Servidor, domínio, HTTPS, execução contínua, monitoramento e backup fora da máquina continuam sendo itens de implantação em produção. O arquivo ZIP é fonte versionada, não um instalador portátil.
