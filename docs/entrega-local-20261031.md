# Candidato local para piloto — 31/10/2026

A homologação visual encontrou e corrigiu bloqueios que não apareciam na suíte anterior:

- Atalhos de cadastro e programação do PCM escondidos pelo layout da lousa.
- Detalhe de OS e formulário de conversão de ocorrência montados fora da visualização focada da fila.
- Contrato dos participantes sem os campos de papel/status usados pelo frontend e sessão aparente de trabalho sem intervalo aberto.
- Informações de participantes desatualizadas após pausa e retomada.
- Coerção HTTP de zero e false para null nas respostas do checklist.
- Relatório de conclusão preservado indevidamente ao abrir outra OS.
- Navegação de ocorrências ausente para Produção e massa oficial desse perfil sem as capacidades de consulta necessárias ao formulário. As definições novas de Produção recebem somente leitura de estrutura e ativos, além das capacidades operacionais já previstas; perfis existentes não são modificados pela fábrica de perfis.
- Ocorrência sem parada operacional permanecendo em tratamento após a conclusão da OS. A rotina agora resolve a ocorrência vinculada quando a OS está concluída e não existe parada aguardando retorno. A regra é aplicada nas conclusões normais, revisões aprovadas e liberações pós-intervenção.

Os testes visuais utilizaram um banco exclusivo, com nove perfis da carga oficial e uma conta separada de plataforma. A preventiva OS-00000001 foi concluída com pausa, retomada, checklist, relatório e quatro evidências simuladas. A corretiva OS-00000006 foi criada e liberada pelo PCM e recebida na fila do mecânico.

Um cenário conectado partiu de uma ocorrência de Produção e gerou a OS-00000007. O mecânico assumiu e executou os nove itens, anexou quatro evidências simuladas e encaminhou a conclusão. Qualidade e Segurança registraram as duas assinaturas; ordem, ação, execução e demanda chegaram a COMPLETED. A ocorrência, concluída antes da correção de ligação, foi reconciliada pela mesma rotina corrigida exclusivamente no banco de homologação. Não houve alteração de ordens ou perfis do banco de desenvolvimento.

A indisponibilidade temporária da API apresentou erro controlado e a sessão do PCM foi recuperada após reinício. A plataforma permitiu criar e editar um plano fictício. Os nove perfis foram autenticados em suas interfaces, incluindo mecânica, elétrica e lubrificação. O operador consultou equipamento por código manual; a câmera não estava disponível no navegador.

O pacote é candidato para aceite humano em piloto local. Não representa aprovação de produção. O selo Online indica rede do dispositivo e os indicadores de atividade não constituem presença de usuários em tempo real. A ferramenta não aplicou a largura móvel solicitada; celular, câmera física e impressão precisam ser verificados no piloto.

Os testes de regressão cobrem preservação de zero/false/null e encerramento de ocorrência somente com OS concluída, mantendo pendente uma parada ainda aberta e preservando o instante de encerramento em chamadas repetidas.
