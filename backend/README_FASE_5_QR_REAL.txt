FAB CONTROL — BACK-END 1.1.3 QR OPERADOR REAL

SUBSTITUIR NO GOOGLE APPS SCRIPT:
- 00_Config.gs
- 05_Motor_Operador.gs

NÃO CRIAR ABAS NOVAS.
NÃO ALTERAR AS 29 ABAS EXISTENTES.

ALTERAÇÕES:
- operador.contexto_qr passa a retornar parametros_recentes e parametros_atuais.
- histórico recente ampliado para 20 registros.
- operador.registrar_parametro valida ativo e vínculo do componente.
- versão: 1.1.3-qr-operador-real.

APÓS SUBSTITUIR:
1. Salvar o projeto.
2. Implantar > Gerenciar implantações.
3. Editar a implantação atual.
4. Criar nova versão e implantar.
5. Manter a mesma URL /exec quando a implantação existente for atualizada.
6. Testar sistema.health.
7. Testar operador.contexto_qr com uma TAG real, por exemplo TMP-001.
