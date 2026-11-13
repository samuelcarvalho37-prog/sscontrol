# Entrega integrada para Samuel

Branch de referência: `dev/natan-refinamento-frontend`.

## Marco principal de finalização do TI

O commit `6bc8500` consolida a navegação aprovada por Natan, junto aos commits anteriores desta branch. Samuel deve integrar esse histórico completo. Se a interface no ambiente dele ainda mostrar os atalhos removidos, a integração visual não está concluída: conferir a versão executada, recompilar o frontend e remover conflitos que tenham reintroduzido a navegação anterior.

A lista aprovada de entradas da lateral é **somente**:

1. Integridade do sistema
2. Equipes técnicas
3. Gestão de pessoas
4. Configurações de acesso
5. Importação e exportação
6. Lotes de importação
7. Criar uma cópia
8. Indicadores
9. Documentos
10. Auditoria
11. Suporte VORQIX

Não acrescentar à lateral Estrutura fabril, Cadastro técnico, Materiais e peças, Homologação de planos, Configurações avançadas ou Configurações do sistema. Os recursos de importação de estrutura, ativos e almoxarifado permanecem dentro de Importação e exportação. Ocultar esses atalhos não significa excluir os módulos, APIs ou dados. As permissões e o plano podem restringir o acesso às entradas aprovadas; não devem reintroduzir outras entradas.

Esta lista deve ser usada na revisão de conflitos e na conferência final da interface após o pull. Mudanças futuras nessa navegação precisam ser combinadas antes de substituir o padrão aprovado.

**Ação obrigatória na integração:** se existirem outras áreas ou atalhos de primeiro nível no TI fora desta lista, removê-los da navegação apresentada ao usuário, inclusive acessos equivalentes pela busca de módulos ou pelo menu do perfil. Eles não fazem parte do escopo visual aprovado. Preservar subfluxos necessários das onze entradas, como as categorias de Importação e exportação. Não apagar tabelas, dados, APIs ou recursos compartilhados para fazer essa limpeza visual.

Esta entrega inclui frontend, backend e migrações já versionados nesta branch. Integrar a branch completa; copiar somente o frontend deixa de fora as regras de acesso e as rotas correspondentes. Não substituir a interface desta branch pela camada visual antiga após a integração.

## Padrão visual

- Manter o Centro de Comando do TI, sua navegação lateral, Ctrl+K e painéis redimensionáveis.
- Estrutura, ativos e almoxarifado ficam concentrados em Importação e exportação. Não reintroduzir atalhos separados de Estrutura fabril, Cadastro técnico ou Materiais e peças na lateral do TI.
- Configurações do sistema (motor de configuração) também fica oculto na navegação, busca de módulos e menu do perfil do TI. O módulo e sua API permanecem no código; não reintroduzir seu acesso visual nesta versão.
- Checklists, planejamento, execução e publicação de planos ficam no fluxo do PCM. Homologação não deve reaparecer como atalho do TI.
- O CSS global não deve impor dimensões e aparência a todo botão sem classe: isso quebra controles de janela e componentes com estilos próprios.
- `visual-polish.css` não é mais importado pelo aplicativo gestor. Novas alterações visuais devem respeitar os estilos e os escopos dos componentes.
- O tema do PCM continua próprio de suas telas; o técnico mantém sua identidade independente.

## Backend que acompanha a branch

Inclui as correções anteriores de recuperação/notificações e o controle de acesso da empresa. As migrações 0062 e 0063 fazem parte da entrega: ativação/suspensão pela plataforma e verificação de acesso/validade da assinatura. Aplicar todas as migrações pendentes, na ordem do migrador, sem selecionar apenas esses dois arquivos.

Empresa bloqueada ou assinatura vencida: a API rejeita acesso; os aplicativos limpam a sessão e apresentam o aviso correspondente. Sessões abertas detectam o bloqueio na próxima chamada ou na verificação periódica. Não se trata de desconexão instantânea por WebSocket.

## Integração e execução

1. Buscar a branch com `git fetch origin` e integrar seu histórico completo à branch de trabalho do Samuel. Se houver alterações locais ou divergência, resolver a integração preservando esta interface e as regras da API; não usar reset forçado.
2. Com a branch integrada, instalar as dependências pelos lockfiles:

```powershell
npm --prefix frontend ci
npm --prefix frontend-gestor ci
npm --prefix backend/node-api ci
```

3. Com o ambiente do próprio Samuel configurado e backup do banco de destino, executar o migrador usando uma conta autorizada a alterar o esquema:

```powershell
npm --prefix backend/node-api run db:migrate
```

4. Compilar e reiniciar os serviços com a nova versão:

```powershell
npm --prefix backend/node-api run build
npm --prefix frontend run build
npm --prefix frontend-gestor run build
```

Usar Node 24 e npm 11, conforme o backend. Reiniciar a API compilada e os frontends pelo processo de execução do ambiente; atualizar somente os arquivos sem reiniciar a API pode causar “Rota não encontrada”.

## Fora do Git

Banco local, dados das empresas, backup, credenciais, arquivos `.env`, sessões e uploads não são transferidos por esta entrega. A limpeza local feita para testar a TOZZI não será reproduzida no banco do Samuel por um pull. Manter o ambiente e os dados dele.

## Verificação desta correção visual

Maximização de painel conferida e controles separados. A lateral indica a aba visível em foco, não todas as abas do mesmo grupo. A verificação visual não substitui homologar todos os fluxos no ambiente do Samuel.
