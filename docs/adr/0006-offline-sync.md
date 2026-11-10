# ADR 0006 — Sincronização offline (outbox), notificações e dashboard

- Status: aceito
- Data: 2026-11-10

## Protocolo

- **Push (`POST /sync/push`).** O aplicativo envia até 100 operações do outbox, em ordem. Cada operação tem `operationId` (UUID v4 gerado uma única vez no dispositivo) e `type`: `EXECUTION_START`, `ITEM_UPDATE`, `NOTE_ADD`, `SIGNATURE_SET`, `EXECUTION_FINISH`.
- **Idempotência atômica.** Cada operação roda numa transação que inclui a inserção em `ProcessedOperation` (`INSERT ... ON CONFLICT DO NOTHING`). Reenvio, perda de resposta ou duas requisições simultâneas com o mesmo `operationId` resultam em `DUPLICATE` com o resultado original; o efeito acontece uma única vez. A nota usa o `operationId` como id.
- **Resultados.** `APPLIED`, `DUPLICATE`, `CONFLICT` (409, estado incompatível), `REJECTED` (validação, permissão, não encontrado) e `ERROR` (falha inesperada; `retryable`). Rejeições são definitivas para aquele `operationId`.
- **Dados conflitantes nunca são descartados.** O payload fica em `ProcessedOperation` e é listado em `GET /sync/conflicts`; o app mantém a cópia local marcada até o usuário resolver.
- **Pull (`GET /sync/pull?since=`).** Devolve as ordens visíveis ao usuário alteradas depois do cursor, com todos os detalhes. Alterações em itens, notas, assinatura e atribuições atualizam `updatedAt` da ordem. O cursor tem sobreposição de 2 s para não perder commits tardios, então o cliente deve aplicar os dados de forma idempotente (upsert por `id`/`version`).
- **O servidor é a fonte da verdade.** O app só marca uma operação como confirmada ao receber `APPLIED` ou `DUPLICATE`.

## Transação ambiente

`PrismaService.transactional` junta-se à transação já aberta no contexto assíncrono. Isso permite reutilizar os serviços de domínio dentro da transação do sync sem duplicar regras.

## Notificações

Notificações no app (tabela `Notification`), geradas no mesmo funil que grava a auditoria (`OrderEventsService`): atribuição, remoção, cancelamento, reabertura, aprovação necessária, revisão de assinatura necessária e assinatura devolvida. Push nativo (FCM/APNs) não faz parte do escopo; o app consulta as notificações ao sincronizar.

## Dashboard

`GET /dashboard` devolve contagens por status, agendadas para hoje, atrasadas, sem técnico e pendências (revisão de assinatura e aprovação). Para Professionals, restringe-se às próprias ordens.