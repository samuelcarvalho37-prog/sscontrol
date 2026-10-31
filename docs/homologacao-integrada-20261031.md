# Homologação integrada — 31/10/2026

Integração local da versão `1682366` do Natan com o commit `a7841589` do usuário, na branch `qa/homologacao-integrada-20261031`.

Validação em banco PostgreSQL isolado: 40 testes da API, 41 testes do frontend gestor, 8 verificações de portais/inicialização/sincronização e um teste adicional cobrindo cadastro de corretiva e conclusão de preventiva. Total: 90 aprovados, zero falhas e zero testes ignorados. Contrato SQL, 59 migrações e duas execuções da carga oficial de homologação também aprovados. Backend e ambas as interfaces compilados.

As migrações da branch do usuário foram posicionadas em 0058 e 0059, após o histórico do Natan. Os conflitos foram conciliados preservando a lousa configurável, as correções operacionais e a navegação por notificações.

Corrigidas expectativas antigas dos testes de armazenamento, navegação e inicialização. O teste de transferência agora usa uma OS separada, evitando que sua execução pausada bloqueie corretamente a validação pós-intervenção da outra OS. O teste de numeração conserva 19 requisições concorrentes, com um pool limitado a 8 conexões. Acrescentada integração da plataforma com MFA, planos, empresas, acesso inicial, contrato e logout, além de validação do formato do código de plano antes da persistência.

A homologação visual permanece pendente por indisponibilidade da ferramenta de navegador. O usuário orientou continuar os testes automáticos. Não foram simuladas visualmente queda de rede, presença entre sessões ou todas as interações das abas. Os builds do gestor ainda avisam sobre tamanho de bundles.

O checkout ativo e o banco de desenvolvimento permaneceram preservados. Esta execução não representa aprovação de implantação em produção.
