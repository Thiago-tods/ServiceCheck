# ADR 0008 — App Flutter offline-first

- Status: aceito
- Data: 2026-11-10

## Decisões

- **Pilha:** Flutter, Material 3, Riverpod 3 (`Notifier`/`AsyncNotifier`), GoRouter, Drift/SQLite, Dio, `flutter_secure_storage` para tokens, `intl` + ARB (pt_BR e en).
- **Servidor como verdade; local como fila.** O snapshot do servidor (`OrderRecords`) nunca é editado no aparelho. Alterações do usuário vão para `OutboxOps`; a tela mostra snapshot + pendências, sempre sinalizando o que ainda não foi confirmado (`PendingBadge`, banner de sincronização).
- **Operações encadeáveis offline.** O app escolhe o `executionId` ao iniciar e referencia itens por posição; assim, iniciar, preencher, assinar e finalizar funcionam sem contato prévio com o servidor.
- **Conflitos nunca descartam dados.** Operações `CONFLICT`/`REJECTED` permanecem no aparelho, com a mensagem do servidor, até o usuário descartá-las.
- **Efeito visível até confirmar por pull.** Uma operação `applied` continua refletida na tela até um pull bem-sucedido, evitando "piscadas" entre a resposta do push e a atualização do snapshot.
- **Logout** apaga os dados locais (aparelho compartilhado) e avisa se há alterações não sincronizadas. Trocar de usuário também limpa os dados.
- **Decisões do escritório são online.** Aprovar e revisar assinatura exigem conexão (não podem ser enfileiradas): o servidor valida independência e permissão.
- **Fontes embutidas.** IBM Plex Sans/Mono (licença OFL, arquivo em `mobile/assets/fonts`) para funcionar offline.
- **Código gerado fora do Git.** `*.g.dart` (Drift) e `lib/l10n/gen` são gerados por `build_runner` e `flutter gen-l10n` (a CI faz isso).
- **Kotlin incremental desligado** em `android/gradle.properties`: projeto e cache do pub em drives diferentes quebram o cache incremental no Windows.

## Fora do escopo / limitações conhecidas

- Notificações push nativas (o app consulta as notificações do servidor; a tela exige conexão).
- Criação e atribuição de ordens no app (são tarefas de escritório, feitas via API).
- Revisão de assinatura por membro com permissão explícita (não-Admin): o servidor aceita, mas o app só exibe os botões para Owner/Admin.
- Não houve execução em dispositivo ou emulador nesta fase: validação por testes automatizados e build do APK debug.