# Integração obrigatória — permissões e planos

Esta entrega deve ser integrada como versão completa da branch `dev/natan-refinamento-frontend`: frontend do gestor/TI/PCM, frontend do operador, backend e migrações. Não copiar somente CSS ou somente o frontend. Não restaurar a navegação antiga do TI durante a integração.

## Comportamento entregue

- Catálogo de ações separado por assunto e tipo de operação: consulta, cadastro, edição, exclusão, revisão, publicação, liberação, assinatura, importação, restauração, situação, estoque e custos.
- Matriz por perfil com ON/OFF, busca, categorias, ajuda sobre o efeito da ação e indicação de ações sensíveis. As alterações são rascunhos até Salvar; Descartar restaura a configuração persistida.
- As permissões não determinam o estilo do portal. Conceder uma função a outro perfil preserva sua interface de TI, PCM, técnico ou operador.
- QR Code é uma ação configurável, sem exclusividade do operador. Ferramentas de criação de parâmetro e revisão de checklist têm acesso condicionado nos portais; consultas auxiliares também precisam ser concedidas.
- O backend exige a ação específica em cada rota catalogada. Criar e editar são independentes. Alterações de situação, arquivamento, saldo e custo são verificadas separadamente nos cadastros suportados; alterações mistas exigem todas as ações envolvidas.
- Negativas individuais ou de outro perfil continuam prevalecendo. Os padrões anteriores são herdados quando não existe decisão específica para aquela ação na mesma origem.
- O contrato limita quais funções podem ser usadas; ele não concede automaticamente todas as funções aos usuários. Os módulos contratados também limitam as ações disponíveis.
- O salvamento comercial do plano e da política de permissões é atômico. Códigos desconhecidos são rejeitados.
- As permissões da sessão são consultadas novamente a cada 15 segundos, ao voltar à janela e ao recuperar a conexão. A API verifica a autorização na próxima requisição; a atualização visual pode levar até esse intervalo.

## Planos

| Plano | Configuração inicial | Personalizar permissões pelo TI |
| --- | --- | --- |
| Básico | Cadastros, checklists e ordens; sem área de acompanhamento | Não |
| Inicial | Acrescenta gestão técnica, acompanhamento e indicadores | Não |
| Empresarial | Recursos ampliados | Sim |
| Completo existente | Preserva contrato e padrões existentes | Sim, salvo política comercial explícita |

Os três novos modelos são criados em **rascunho**, sem cobrança automática. A migração usa valor inicial zero; valores definidos depois pelo operador da plataforma pertencem ao banco local, não ao código. A plataforma pode ajustar os módulos e funções de cada plano. Retirar um módulo impede usar suas funções mesmo que estejam selecionadas na lista.

## Regras preservadas

- Assinar ou revisar continua sujeito à habilitação técnica, ao escopo dos registros e à política de assinatura do documento. Conceder a ação não falsifica a habilitação de qualidade ou segurança.
- Duas ações essenciais de administração de permissões permanecem protegidas no perfil TI para evitar perda do canal de recuperação dos acessos.
- A navegação do TI mantém somente: Integridade do sistema, Equipes técnicas, Gestão de pessoas, Configurações de acesso, Importação e exportação, Lotes de importação, Criar uma cópia, Indicadores, Documentos, Auditoria e Suporte VORQIX.
- Estrutura fabril, Cadastro técnico, Materiais e peças e Configurações do sistema não voltam como atalhos independentes. Seus recursos internos e dados continuam preservados.
- O tema do técnico continua independente do tema da lousa do PCM.

## Integração do Samuel

1. Preserve alterações locais e integre a branch completa; não use reset destrutivo nem selecione apenas arquivos visuais.
2. Instale as dependências pelos lockfiles de cada projeto, se necessário.
3. Com o usuário proprietário autorizado do PostgreSQL, aplique as migrações **0064, 0065, 0066 e 0067** pelo migrador existente. Não altere migrações já aplicadas.
4. Compile e reinicie a API. Sem isso, a interface nova pode encontrar rotas antigas ou políticas ausentes.
5. Compile os dois frontends e confira o plano efetivo da empresa antes de testar os perfis.
6. Revise as concessões desejadas em Configurações de acesso; esta entrega não transforma todos os perfis em administradores.

Na homologação local de Natan, as quatro migrações foram aplicadas e a API reiniciada. Contas, sessões, preços configurados localmente, credenciais e dados da TOZZI não são transportados pelo Git.

## Validação e limites

- Build do backend e dos dois frontends.
- Dezesseis testes específicos: catálogo/rotas, ações independentes, limites comerciais, decisões negativas, classificação de alterações de cadastro e integração real com RLS. Os testes de banco usam transações revertidas.
- Conferência no navegador da matriz categorizada, ajuda, rascunho/descartar e bloqueio de acompanhamento no plano Básico.
- O catálogo detalhado está em `2026-11-14-catalogo-de-permissoes.md`.

Esta entrega estabelece o controle granular e adapta os controles dos fluxos citados. Não representa homologação manual de todas as combinações possíveis entre cada ação, perfil e tela. Funções que exigem consultas auxiliares não ficam utilizáveis apenas com a ação de escrita; a ajuda e as ferramentas informam essa necessidade. Novas telas de calendário/Kanban e a reformulação completa do acompanhamento não fazem parte desta etapa.
