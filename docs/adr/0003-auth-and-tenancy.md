# ADR 0003 — Autenticação, multiempresa e papéis

- Status: aceito
- Data: 2026-11-10

## Decisões

- **Senhas:** scrypt do Node (`crypto`), com salt por senha e comparação em tempo constante. Evita dependência nativa. No login com e-mail inexistente, compara-se contra um hash falso para não revelar quais e-mails existem.
- **Access token:** JWT HS256 de vida curta (padrão 15 min), com algoritmo fixado na verificação.
- **Refresh token:** valor opaco aleatório; só o SHA-256 é gravado. Cada uso rotaciona o token dentro da mesma família. Reapresentar um token já usado revoga a família inteira (indício de roubo). Duas renovações simultâneas com o mesmo token: uma vence e a outra recebe 401 e revoga a família, o que é conservador de propósito.
- **Multiempresa:** o usuário escolhe a empresa pelo header `X-Company-Id`. O `TenantGuard` exige vínculo ativo; "empresa inexistente" e "não é membro" retornam o mesmo 403. Toda consulta de domínio deve filtrar por `companyId` vindo do contexto, nunca do corpo da requisição.
- **Papéis:** Owner, Admin, Receptionist e Professional por vínculo. Cadeia de guards global: JWT, tenant, papéis. Admin só gerencia Receptionist e Professional. Uma empresa nunca fica sem Owner ativo (bloqueio de linhas com `FOR UPDATE`).
- **Sem exclusão de vínculos:** membros são desativados (`active=false`), preservando histórico.
- **Auditoria append-only:** trigger no PostgreSQL rejeita `UPDATE` e `DELETE` em `AuditLog`. `TRUNCATE` continua permitido só para reset dos bancos de teste.

## Consequências

- Versões fixadas por compatibilidade com CommonJS/Jest: `@nestjs/config` 4 e `@nestjs/jwt` 11 (as séries 12 são apenas ESM).
- Limitação de taxa (rate limiting) para rotas de autenticação fica como melhoria futura.