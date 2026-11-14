# Adaptação das funções ao portal TI e PCM

Integrar a branch completa `dev/natan-refinamento-frontend`, incluindo a entrega anterior de permissões. Esta etapa muda o frontend do gestor; não modifica tabelas, dados, credenciais ou permissões persistidas da empresa.

## Mudanças

- A experiência visual usa o tipo técnico do perfil (`ADMIN` para TI e `MANAGER` para PCM), independentemente do código/nome escolhido pela empresa. Sessões legadas sem tipo mantêm o reconhecimento dos códigos conhecidos. Um perfil `CUSTOM` não é convertido em PCM apenas porque recebeu esse nome.
- O estilo e o tema do PCM não dependem mais da permissão de indicadores. Retirar a consulta dos indicadores oculta a lousa, mas não transforma o restante do PCM na interface clara antiga.
- QR e Ferramentas autorizadas passam a fazer parte de **Módulos adicionais**, conforme as permissões da sessão. São encontrados na lateral e no Ctrl K do TI.
- As funções adicionais usam as janelas existentes do TI: abas, redimensionamento, minimizar/maximizar e fechamento. O pop-up independente e os atalhos soltos do cabeçalho foram retirados.
- O leitor QR acompanha o ambiente TI ou o tema do PCM, com consulta por TAG/código como alternativa à câmera. Erros de webcam ausente, autorização negada ou leitura nativa indisponível são mostrados na própria tela.
- O componente não exibe uma ação de ficha completa sem um destino de navegação fornecido pelo portal.
- O técnico e a produção não receberam uma nova identidade visual nesta etapa.

## Banco e instalação no Samuel

Não existe migração nova nesta etapa. Samuel deve integrar todo o histórico, inclusive as migrações **0064–0067** da etapa anterior de permissões, compilar a API e os frontends e usar seu próprio ambiente. O Git transporta código e migrações, não o conteúdo do banco local da TOZZI.

Não substituir o banco de Samuel por um dump local sem uma decisão específica sobre os dados que devem ser preservados. As migrações alinham a estrutura e as regras versionadas; contas e cadastros locais são outra operação.

## Validação

- Teste de seleção da experiência por tipo, incluindo código personalizado, incompatibilidade de tipo e compatibilidade legada.
- Build do frontend gestor/TI/PCM.
- Navegador: QR localizado pelo Ctrl K e aberto como janela do TI; PCM mantém seu tema mesmo com somente QR/Conta liberados.
- O navegador de homologação não disponibilizou leitura nativa de QR; a mensagem e o campo de consulta foram verificados. Captura real por câmera/webcam não foi homologada neste ambiente.

## Escopo restante

Esta entrega adapta QR e as ferramentas adicionais já implementadas. Não cria telas para toda ação da API em todos os perfis. A matriz padrão/restauração por perfil, a permissão independente de abrir a lousa e a recuperação de permissões protegidas pela plataforma continuam como etapas próprias; nenhuma concessão foi ligada automaticamente para contornar a configuração atual.
