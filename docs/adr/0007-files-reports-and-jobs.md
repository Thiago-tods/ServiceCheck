# ADR 0007 — Anexos, relatórios PDF, fila de jobs e proteção da API

- Status: aceito
- Data: 2026-11-10

## Decisões

- **Armazenamento.** Interface `StorageDriver` com `put/get`. Implementações: disco local (desenvolvimento e testes) e S3 (`@aws-sdk/client-s3`), que atende AWS S3 e serviços compatíveis (MinIO, R2, Backblaze) via `S3_ENDPOINT`. As chaves são geradas pelo servidor e validadas contra travessia de caminho. O driver S3 é testado com cliente simulado; **não foi validado contra um serviço S3 real**.
- **Anexos.** Aceitam PNG, JPEG, WebP e PDF até 10 MB. O tipo declarado precisa coincidir com os bytes do arquivo (assinatura de formato). O nome é saneado. O download força `attachment` e `nosniff`. O `id` do anexo pode ser escolhido pelo dispositivo, tornando o reenvio idempotente. Foto anexada a um item `PHOTO` o conclui.
- **Fila de jobs sem Redis.** Tabela `Job` com `FOR UPDATE SKIP LOCKED`: vários workers não executam o mesmo job. Tentativas com recuo exponencial, estado final `FAILED` e recuperação de jobs presos em `RUNNING` há mais de 5 minutos. O worker roda no próprio processo (`JOBS_WORKER_ENABLED`).
- **Relatório PDF assíncrono.** `POST /work-orders/:id/reports` devolve 202; o worker gera o PDF (pdfkit, idioma do solicitante) e o guarda no storage; o cliente consulta `GET /reports/:id` e baixa em `/download`. O PDF usa fontes padrão do PDF (Helvetica/Courier); a identidade tipográfica IBM Plex vale para o app e não está embutida no PDF.
- **Fuso horário.** O Prisma grava `DateTime` como horário UTC sem fuso. SQL cru deve comparar e gravar em UTC (`now() AT TIME ZONE 'UTC'`); um teste real revelou o erro quando o servidor estava em UTC-3.
- **Rate limiting.** `@nestjs/throttler`: 600 req/min por IP no geral e 10/min em registro, login e refresh. Atrás de proxy reverso é preciso configurar `trust proxy` para que o IP real seja usado.
- **Sentry.** Inicializado apenas se `SENTRY_DSN` existir; um filtro global reporta somente erros inesperados (não `HttpException`). Sem DSN nada é enviado. Não validado contra um projeto Sentry real.