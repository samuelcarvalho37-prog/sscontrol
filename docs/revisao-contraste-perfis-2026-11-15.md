# Revisão visual de contraste — 15/11/2026

Revisão no Chrome, usando sessões de homologação pelo portal compartilhado na porta 5186. Nenhuma OS foi criada, assumida, iniciada ou assinada. Credenciais e permissões não foram alteradas.

## Áreas percorridas

| Perfil | Telas consultadas |
| --- | --- |
| Operador | Lista compartilhada de OS e formulário de solicitação, cancelado sem envio |
| Produção | Resumo e lista compartilhada de OS |
| Mecânico | Fila, próxima ação e detalhe da OS sem assumir execução |
| Elétrica | Fila e próxima ação |
| Manutenção/lubrificador | Fila e detalhe da OS sem assumir execução |
| PCM | Lousa e conta no tema escuro |
| Qualidade | Conta e ferramentas disponíveis |
| Segurança | Conta e navegação disponível |
| TI | Centro de comando e gestão de pessoas, sem editar usuários |
| Plataforma | Cadastro e planos/módulos em demonstração somente leitura |

## Correções

- Navegação inferior: rótulos inativos e selecionados escurecidos nas superfícies claras. As regras existentes do tema escuro continuam prevalecendo.
- Técnico: removida a colisão entre fundo escuro legado e texto secundário do tema claro. Card, título, equipamento e texto auxiliar agora usam as cores do próprio workspace. Link de retorno com cor legível na superfície clara.
- Conta no shell PCM: fundo, títulos, valores e textos auxiliares passam a acompanhar o mesmo tema. Corrige texto quase branco sobre cartões brancos e títulos escuros sobre fundo escuro.
- TI: avatar com texto claro no fundo escuro; legendas, contadores e controles auxiliares com contraste maior.
- Plataforma: textos auxiliares e cabeçalhos de tabela escurecidos.

## Verificação e limites

Inspeção visual com capturas e leitura de estilos calculados dos textos visíveis. Como referência, o texto auxiliar do card técnico apresentava contraste aproximado de 3,11:1, e alguns valores da conta escura ficavam perto de 1,05:1. Depois das correções, o verificador local não apontou texto visível abaixo de 4,5:1 nas vistas conferidas da fila técnica e conta. Esta medição simples não certifica acessibilidade completa: transparências, gradientes, estados ocultos e telas fora da área visível exigem avaliação própria.

Esta revisão não equivale a testar todos os formulários e estados de cada módulo, nem substitui o aceite físico no iPhone/tablet.

## Pendência funcional observada

Os usuários de Qualidade e Segurança foram direcionados ao shell PCM, exibindo somente Ferramentas e Conta. Em Qualidade, Ferramentas informou revisão habilitada sem consulta à lista/detalhes. Isso limita a revisão visual do fluxo de validação. Investigar separadamente o direcionamento em `workspaceExperience` e as capacidades efetivas; não ampliar permissões como solução para um problema visual.
