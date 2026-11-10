# ADR 0004 — Catálogo, pessoas e checklists versionados

- Status: aceito
- Data: 2026-11-10

## Decisões

- **Técnico = vínculo (Membership).** Não há entidade "técnico" separada: qualquer vínculo ativo pode ser atribuído a ordens. Especialidades e equipes referenciam o vínculo, evitando duplicar identidade e papéis.
- **Clientes são dados de escritório.** Apenas Owner, Admin e Receptionist acessam. Professionals veem dados do cliente somente pelas ordens que recebem (snapshot na ordem).
- **Sem exclusão.** Clientes, contatos, endereços, especialidades, equipes e serviços são desativados (`active=false`), preservando histórico.
- **Checklists imutáveis desde a criação.** Alterar um checklist publica uma nova versão (`ServiceChecklistVersion` + `ChecklistItem`). Triggers no PostgreSQL rejeitam `UPDATE` e `DELETE` nessas tabelas. A ordem de serviço copia os itens (snapshot) ao ser criada.
- **Isolamento.** Todo acesso filtra por `companyId` do contexto; recursos de outra empresa respondem 404, e testes e2e cobrem recursos aninhados.
- **Concorrência de publicação.** `UNIQUE(serviceId, version)` impede versões duplicadas; publicações simultâneas conflitantes recebem 409.