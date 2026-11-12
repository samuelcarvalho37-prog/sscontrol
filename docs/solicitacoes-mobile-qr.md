# Solicitações de OS no celular e tablet

Revisão de 12/11/2026, posterior ao fluxo compartilhado `f40d17f`.

## Uso

Todos os perfis operacionais usam o mesmo painel. A entrada mostra as ordens da unidade autorizada, incluindo concluídas e canceladas. Cada linha contém título, código e situação; ao tocar, abre detalhes com localização, pessoas, horários, relato, execução e assinaturas. Solicitações ficam na aba ao lado. Os filtros Todas, Em aberto e Concluídas/encerradas consultam o servidor com paginação.

Solicitar OS abre cinco etapas:

1. Local: ler QR ou selecionar planta → setor → linha → equipamento. Somente equipamentos ativos do escopo do usuário aparecem. QR de componente identifica o equipamento e informa que o pedido será do equipamento.
2. Problema: tipo de trabalho, título e situação atual.
3. Avaliação: parada informada, risco de parada, segurança, produção, qualidade e redundância; indicação de assinatura de Qualidade/Segurança.
4. Descrição e foto opcional, com preparação JPEG antes do envio.
5. Revisão do relato e nova consulta aos trabalhos existentes antes de enviar ao PCM.

O pedido e as OS em aberto do equipamento aparecem como aviso de possível duplicidade. É possível consultar os detalhes sem perder o formulário. O alerta não proíbe outro defeito no mesmo equipamento nem substitui a análise do PCM. Não há bloqueio automático por semelhança de texto.

A prioridade é calculada também pelo servidor. Informar que o equipamento está parado descreve a situação no pedido; não abre uma parada física nem libera execução. O fluxo operacional e as assinaturas continuam sob as permissões existentes.

## Compatibilidade e atualização

- Não há migração nova; exige a `0061_shared_work_requests.sql` da entrega anterior.
- Atualizar/recompilar API e ambos os frontends. O frontend gestor reutiliza o leitor e o formulário do diretório do operador, incluindo o fallback ZXing já existente. Instalar as dependências dos dois projetos conforme seus arquivos de lock antes de compilar em um ambiente novo.
- O leitor não navega para endereços recebidos pelo QR. Consulta o código no servidor e verifica unidade/tenant. Câmera sem suporte ou permissão mantém digitação e seleção manual.
- Câmera em celular requer origem segura HTTPS e autorização do próprio navegador. A atualização não altera certificados, firewall ou rede.
- A foto e a triagem ficam no histórico existente, com leitura autenticada e escopo verificado. A correção de pedido devolvido preserva o histórico e disponibiliza o relato atualizado ao PCM.
- Modal nativo mantém foco e permite fechar; lista e formulário têm controles para toque e rolagem própria, sem sobreposição do cabeçalho.

## Verificações

- Integração em banco descartável: 10 testes passaram. Inclui resolver QR, hierarquia autorizada, triagem persistida, prioridade crítica, ausência de parada automática, consulta de possíveis duplicidades, recusa sem escopo e OS concluída visível aos oito perfis operacionais.
- Frontend: 59 testes passaram, incluindo isolamento da seleção entre plantas/setores e regras de prioridade.
- Conferência no Chrome em viewport 390×844 e 820×1180: formulário até revisão, aviso de pedido existente, lista compacta e detalhe de OS concluída com duas assinaturas. Formulário visual cancelado sem criar solicitação na homologação.
- Builds/typecheck de API, gestor e operador verificados.

Continua necessário o aceite de câmera e captura/envio/reabertura da foto em iPhone/tablet físicos na rede HTTPS de homologação. A conferência de viewport não substitui esse teste de hardware.
