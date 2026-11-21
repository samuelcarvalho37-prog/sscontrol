# Homologação de solicitação e OS — TOZZI — 20/11/2026

## Cenário autorizado

Solicitação pela Qualidade para vazamento no reparo do Virador de Tambor, L01-EQ01, Conservas / Linha 01. PCM avalia e libera. Raimundo executa como principal, Geovane participa como auxiliar. Qualidade acompanha; não há assinatura final de Qualidade ou Segurança. Nenhuma intervenção física ou consumo de material está sendo declarado como real.

## Executado e conferido pela interface

- Detectada ausência de vínculos de escopo de planta para os usuários existentes. Após autorização explícita do responsável, nove usuários ativos foram vinculados exclusivamente à planta Tozzi Alimentos, preservando as capacidades de cada função. Auditoria `084046ef-2a2e-4480-96e6-23f727f2071c`.
- Qualidade passou a visualizar os equipamentos e enviou o formulário completo. Pedido `91ada393-b720-4a84-8ae9-3ad328d63e37`.
- PCM registrou decisão de tratar agora e parecer favorável ao teste.
- Como não havia roteiro publicado, PCM criou e publicou `TESTE HOMOLOGAÇÃO — Reparo do Virador de Tambor`, uma etapa de texto para registrar resultado exclusivamente simulado, sem assinatura das áreas.
- PCM criou a **OS-00000001**, vinculada ao pedido e ao equipamento correto, prioridade baixa, sem validação final exigida.
- Raimundo assumiu e iniciou a execução; convidou Geovane como colaborador e o convite foi aceito no perfil do segundo mecânico.
- Raimundo respondeu o checklist e registrou o relatório como simulação, sem intervenção física, consumo de material ou custo real. A OS foi concluída.
- Qualidade visualiza a ordem concluída, seus detalhes e a indicação de que não há validação final obrigatória. Geovane também a visualiza no histórico de execuções concluídas.

## Inconsistência encontrada e corrigida

O acompanhamento do PCM oferecia seleção e atribuição manual de responsável. A API já bloqueia esse procedimento com `MAINTENANCE_ACTION_ASSIGNMENT_DISABLED`, pois a regra vigente é o técnico elegível assumir a OS. A ordem foi salva e liberada antes desse erro; não foi criada outra ordem. O frontend foi alinhado à regra: removida a atribuição manual e explicados o registro do executor pelo próprio perfil e dos auxiliares na conclusão.

Também foi identificado que o histórico da execução só consultava a tabela legada de apoios, omitindo colaboradores aceitos pelo fluxo atual de equipe. A consulta agora consolida os dois registros sem duplicidade, preservando o técnico principal e isolando a empresa e a execução corretas. A verificação de tipo do frontend foi aprovada; a API foi reiniciada com a correção. A confirmação visual final nas telas segue pendente porque a conexão automatizada ao Chrome ficou indisponível durante a recarga.

## Pendente — não considerar aprovado

- Recarregar as telas do PCM, Qualidade e Raimundo e confirmar visualmente que **Geovane** aparece como colaborador/auxiliar da OS-00000001; a API já contém a correção.
- Segundo cenário, com interferência na Qualidade e assinatura final obrigatória, será testado depois deste.
- Login e câmera no iPhone continuam pendentes de teste físico.

Não houve troca de senha, tentativa com senha inventada, falsa autenticação dos técnicos ou alteração direta do estado da OS no banco.
