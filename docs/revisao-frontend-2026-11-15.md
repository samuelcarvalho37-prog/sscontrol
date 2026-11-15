# Revisão de interface — 15/11/2026

## Entrega

Acabamento compartilhado para solicitações, histórico de OS, formulários, conta, fila técnica, planejamento do PCM, validação e superfícies administrativas. Mantidos os destinos de navegação, a organização dos módulos e as personalizações da lousa. Controles receberam espaçamento, cantos, foco visível e tratamento de contraste consistentes; formulários e listas operacionais se adaptam a telas estreitas. Movimento reduzido respeita a preferência do dispositivo.

Correções funcionais do frontend:

- A atualização do contexto técnico não troca mais uma área que o usuário já escolheu no PCM.
- A navegação reinicia a rolagem do contêiner interno, evitando abrir uma área pelo meio da página.
- A conta deixa de aparecer simultaneamente à página inicial do técnico.
- O diálogo técnico mantém o foco pelo teclado, fecha com Esc quando não está enviando e devolve o foco ao acionador. Fechar fica indisponível durante envio.
- Carregamento e recuperação de falha têm cores legíveis inclusive no tema escuro.
- Rótulos conhecidos de severidade e execução de checklist aparecem em português.

## Verificação

- 72 testes de frontend aprovados, incluindo dois casos novos para preservar a navegação durante atualização do contexto.
- Corrigida a raiz do Vite no teste de acompanhamento e atualizada a expectativa obsoleta do teste de separação TI/PCM para o contrato atual de capacidades.
- Compilações de produção do frontend compartilhado/gestor e do operador aprovadas.
- Orçamento do JavaScript inicial aprovado: aproximadamente 348 KB, 105 KB gzip, abaixo dos limites de 600 KB/180 KB.
- Revisão visual no Chrome: Qualidade (lista, formulário e diálogo), Mecânico (fila e histórico), PCM (lousa, manutenção, acompanhamento e conta), Produção (lista) e TI (centro de comando e gestão de pessoas).
- Conferência responsiva representativa em 390 × 844 e 768 × 1024: listas/formulários compartilhados e fila técnica sem transbordamento horizontal observado. Tab, Shift+Tab, Esc e devolução do foco conferidos no diálogo técnico.

## Limites e próximos testes

Esta revisão não substitui a homologação funcional de cada perfil e cada transição de OS. Não foram submetidas novas solicitações, decisões, assinaturas ou alterações de contas durante a conferência visual. Os componentes compartilhados atendem os demais perfis, mas nem todas as combinações de perfil, tema, dados e tela foram exercitadas nesta rodada.

O Centro de Comando TI mantém sua restrição existente a telas de pelo menos 901 px. Torná-lo plenamente móvel exige adaptar seu gerenciador de janelas; essa alteração estrutural não faz parte deste acabamento. O teste físico de câmera/anexo no iPhone continua necessário.

Próxima etapa: homologar solicitação → avaliação pelo PCM → execução técnica → assinatura exigida → histórico, com os usuários acompanhando os resultados. Permissões, credenciais, cálculos e banco de dados não foram alterados por esta entrega.
