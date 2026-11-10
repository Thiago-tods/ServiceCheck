# ADR 0005 — Ordens de serviço, agenda e execução

- Status: aceito
- Data: 2026-11-10

## Máquina de estados

`OPEN → SCHEDULED → IN_PROGRESS → (PENDING_APPROVAL | SIGNATURE_REVIEW) → APPROVED`, com `CANCELLED` a partir de `OPEN/SCHEDULED`.
Assinatura ausente ou recusada leva a `SIGNATURE_REVIEW`; a revisão aceita (`PENDING_APPROVAL`) ou devolve (`IN_PROGRESS`, mesma execução). Reabertura (`PENDING_APPROVAL/APPROVED → SCHEDULED/OPEN`) cria uma nova execução `PENDING` e preserva a anterior.

## Decisões

- **Serialização por ordem.** Todo comando que muda uma ordem trava a linha (`SELECT ... FOR UPDATE`) e faz compare-and-set do status. Comandos concorrentes conflitantes recebem 409; `version` é incrementada a cada mudança (base para a sincronização offline).
- **Conflito de disponibilidade no banco.** Constraint de exclusão (`btree_gist`) impede intervalos sobrepostos de atribuições ativas do mesmo vínculo. Intervalos são semiabertos, então janelas adjacentes são válidas. A checagem na aplicação só produz a mensagem amigável.
- **Histórico de atribuições.** Atribuições são liberadas (`releasedAt`), nunca apagadas. Índice único parcial garante um único responsável principal ativo por ordem e por execução.
- **Snapshots.** A ordem guarda cópia do cliente, endereço, contato e do checklist (versão fixa). Edições posteriores não reescrevem o histórico. A execução copia os itens do snapshot.
- **Aprovação independente.** Só Owner/Admin aprovam, e nunca quem participou da última execução.
- **Revisão de assinatura.** Owner/Admin ou vínculo com `canReviewSignatures`. A assinatura (PNG validado por tamanho e assinatura de arquivo) é guardada no banco por ser pequena.
- **Sem exclusão.** Triggers rejeitam `DELETE` em ordens, atribuições, execuções e revisões.
- **Numeração.** Sequência por empresa via `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, atômica sob concorrência.