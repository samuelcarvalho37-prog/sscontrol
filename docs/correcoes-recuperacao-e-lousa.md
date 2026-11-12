# Recuperação de acesso e organização do PCM

- O protocolo de recuperação identifica o pedido; não autentica nem autoriza redefinição.
- A redefinição continua restrita à capacidade `admin.identity.manage` e exige troca de senha no primeiro acesso.
- Ao redefinir, os pedidos pendentes são consumidos, o indicador do usuário é limpo, os avisos são retirados e as sessões anteriores são revogadas na mesma transação.
- Novos pedidos geram notificação para usuários ativos que podem gerenciar acessos e ler notificações, respeitando concessões e negações de capacidades.
- A central consulta os avisos mesmo fechada para atualizar o contador. A atualização periódica pausa quando a página está oculta ou sem rede.
- O botão de redefinição sinaliza pedidos pendentes. A notificação abre Gestão de pessoas.
- Lousa: indicadores e ferramentas do dashboard. Manutenção: cadastros, checklists e planos. Acompanhamento: criação de OS, fila, solicitações e consulta compartilhada.
- A navegação do PCM usa as cores do tema também nos estados de foco e seleção.

Teste PostgreSQL: `tests/password-recovery-notifications.test.ts`, usando `PCM_IMPORT_TEST_URL`; todas as alterações do teste são revertidas.

- Solicitações ficam em uma aba do Acompanhamento, preservando o leitor de QR Code e as permissões existentes.
- Busca, setor e contagem ficam alinhados; a lista identifica localização, responsável e programação, com paginação no final.
- O Técnico tem identidade visual independente do tema salvo no PCM e disposição responsiva para celular, tablet e computador.
- Menus de contexto, editor de cor e carregamento do PCM usam as superfícies do tema.
- Validação: build do gestor e do operador, 17 testes de frontend e teste PostgreSQL de recuperação com rollback. A revisão visual autenticada de todos os perfis permanece necessária.
