# Fluxo operacional PCM

A especificação de fluxo foi implementada e detalhada em [pcm-acompanhamento.md](pcm-acompanhamento.md).

- TI mantém a administração técnica e o cadastro da estrutura principal.
- PCM prepara checklists, solicita revisão quando necessário, disponibiliza planos e encaminha OS à manutenção.
- Técnico assume e executa o trabalho, registrando checklist, pausas e conclusão.
- Produção registra ocorrências; PCM decide tratar, agendar ou recusar com retorno ao solicitante.
- Qualidade/Segurança participam quando a revisão ou a validação correspondente foi solicitada.

## Implementação atual

Acompanhamento possui contadores completos, consulta paginada, responsáveis, executor, localização, motivo de pausa, consulta do checklist, atribuição e solicitação de atualização. Permite criar trabalho a partir de um plano ou checklist publicado.

O checklist pode ser publicado sem assinatura adicional. Quando há revisão, permanece bloqueado para execução até a aprovação e publicação. Publicar um modelo reutilizável não dispara uma OS por si só: o PCM escolhe criar e enviar o trabalho.

O plano operacional interno pode ser gerado automaticamente a partir do checklist publicado, reutilizando a mesma versão e preservando as configurações de execução. Planos de programação continuam disponíveis para manutenção planejada.

A importação respeita cada tela. PCM não importa plantas, setores ou linhas. As capacidades específicas de edição continuam obrigatórias, além da capacidade de importação.

Assinaturas e pareceres aprovados possuem arquivamento rastreável em Documentos do TI, sem mudar a interface gráfica do TI.

## Limites da etapa

As interfaces existentes de técnico e produção continuam atendendo seus perfis. Sua reformulação visual completa e a experiência de primeiro acesso por QR Code são etapas próprias, conforme a orientação de tratá-las depois do fluxo PCM. Não foi criado um acesso anônimo para registrar ocorrências.

A explicação e os procedimentos de ativação estão no documento de acompanhamento. A homologação final dos diferentes perfis deve ser feita no ambiente de destino depois das migrações e da atualização da API.
