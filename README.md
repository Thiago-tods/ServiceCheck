# ServiceCheck

> Trabalho em campo. Controle em cada etapa.

[English version](README.en.md)

Sistema **mobile-first** de ordens de serviço para técnicos de manutenção, eletricistas, instaladores e equipes externas. O aplicativo funciona **offline-first**: o técnico executa a ordem sem sinal e as alterações sincronizam sozinhas quando a conexão volta.

Projeto open source de portfólio. Não é comercial e não possui monetização.

## O que ele faz

- Multiempresa com isolamento rigoroso; um usuário pode pertencer a várias empresas (Owner, Admin, Receptionist, Professional).
- Clientes, contatos, endereços, especialidades, equipes e serviços com **checklists versionados e imutáveis**.
- Ordens com atribuição, **histórico de atribuições**, agenda e **bloqueio de conflito de disponibilidade** garantido no banco.
- Execução com vários técnicos e um responsável principal, checklist, observações, fotos e **assinatura na tela**.
- Assinatura ausente ou recusada vai para **revisão**; a **aprovação é independente** de quem executou; reabertura exige justificativa e cria nova execução.
- **Outbox offline** com `operationId` estável: operações idempotentes, conflitos preservados, estados de sincronização sempre visíveis.
- Relatório **PDF** assíncrono, dashboard, notificações no app, auditoria imutável.
- Interface em **português e inglês**, tema claro/escuro, IBM Plex Sans/Mono.

> O backend cobre mais do que o app: cadastros, criação de ordens e relatórios PDF, por exemplo, só existem na API. Veja [o que existe no app e o que existe só na API](#o-que-existe-no-app-e-o-que-existe-só-na-api).

## Stack

| Camada | Tecnologias |
|---|---|
| Mobile | Flutter, Dart, Material 3, Riverpod, GoRouter, Drift/SQLite |
| Backend | NestJS, TypeScript, PostgreSQL, Prisma, REST `/api/v1`, JWT com refresh rotativo |
| Infra | GitHub Actions, armazenamento compatível com S3, fila de jobs no PostgreSQL (sem Redis), Sentry opcional |
| Testes | Jest (unitário e integração com **PostgreSQL real**), Flutter Test |

## Como o offline funciona (resumo)

1. Toda ação do técnico vira uma operação com UUID no banco local (`OutboxOps`).
2. A tela mostra o último snapshot do servidor **mais** as operações pendentes, marcadas como "Pendente".
3. O motor de sincronização envia em ordem (`/sync/push`); reenvios são seguros. Depois busca mudanças (`/sync/pull`).
4. Uma operação só deixa de ser "pendente" quando o servidor confirma. Conflitos e rejeições ficam guardados e visíveis.

Detalhes em [docs/adr/0006-offline-sync.md](docs/adr/0006-offline-sync.md).

## Começando

Guia completo (Windows / PowerShell), com dados de demonstração e geração do APK: [docs/development.md](docs/development.md).

```powershell
cd backend
npm install
Copy-Item .env.example .env
# edite backend/.env: DATABASE_URL e JWT_ACCESS_SECRET (veja abaixo)
npx prisma migrate deploy
npm run start:dev
```

Antes de iniciar, edite `backend/.env`: `DATABASE_URL` e um segredo JWT aleatório (o valor de exemplo só funciona em desenvolvimento; com `NODE_ENV=production`, ou com `NODE_ENV` ausente, a API recusa iniciar). Detalhes, banco local e **dados de demonstração** (`npm run seed:demo`) em [docs/development.md](docs/development.md).

```powershell
cd mobile
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

## Estrutura

```
servicecheck/
  backend/   API NestJS (monólito modular)
  mobile/    App Flutter (feature-first)
  docs/      Arquitetura, API, desenvolvimento e ADRs
  .github/   CI do backend e do app
```

## Documentação

- [Arquitetura](docs/architecture.md) · [API](docs/api.md) · [Desenvolvimento](docs/development.md)
- Decisões de arquitetura: [docs/adr](docs/adr)

## O que existe no app e o que existe só na API

O backend é mais completo que o aplicativo. Hoje o app cobre o trabalho do técnico e as decisões de escritório mais simples; o restante só pode ser feito chamando a API.

| Funcionalidade | API | App |
|---|---|---|
| Login, logout, renovação de sessão | sim | sim |
| Lista e detalhe de ordens, agenda, dashboard, notificações | sim | sim |
| Iniciar execução, checklist, observações, fotos (câmera e galeria), assinatura, finalizar; tudo offline com sincronização | sim | sim |
| Aprovar execução e revisar assinatura (Owner/Admin) | sim | sim, só para Owner/Admin |
| Reabrir ordem com justificativa | sim | **não** (o app só exibe o aviso de uma ordem já reaberta) |
| Criar, atribuir e cancelar ordens | sim | **não** |
| Cadastros: clientes, contatos, endereços, especialidades, equipes, serviços, checklists e membros | sim | **não** |
| Relatório PDF (geração assíncrona e download) | sim | **não** (sem tela para pedir ou ver relatórios) |
| Cadastro de usuário (`/auth/register`) | sim | **não** (sem tela de cadastro; use a API ou `npm run seed:demo`) |
| Notificações push nativas | não | não |

## Estado do projeto e limites conhecidos

**Testes automatizados.** Os números abaixo vêm de rodar os testes na árvore de trabalho deste repositório. A última verificação em **clone limpo** (que instalou as dependências do zero) aconteceu antes da política de segredo JWT e do seed atuais e passou com backend 34 unitários e 71 de integração, Flutter 51 testes e o APK debug; **ela ainda não foi repetida com o código atual**.

- Backend: 110 testes unitários (Jest, incluindo a validação do ambiente e a política do segredo JWT), 153 testes do script de dados de demonstração (`node:test`) e 71 de integração contra PostgreSQL real, incluindo concorrência.
- Flutter: 51 testes e `flutter analyze` sem avisos. O APK debug compila.

**Validação manual no emulador Android** (Pixel_10, Android 37) contra um backend local, pela interface do app: login, logout (a sessão termina e a família do refresh token é revogada), renovação automática do token de acesso expirado, volta ao login quando o refresh é inválido, execução offline, sincronização ao reconectar, tratamento de operação rejeitada pelo servidor, câmera (online e offline), assinatura na tela, finalização com validações e aprovação pelo Owner.

Alguns casos foram verificados **chamando a API diretamente, não pela interface**: aprovação negada a quem participou da execução e a um Professional, reuso e expiração do refresh token, e a validação de finalização no servidor.

**Ainda não validado:**

- Aparelho físico e iOS (o app nunca foi compilado para iOS).
- Driver S3 e Sentry contra serviços reais (testados apenas com simulações; sem DSN o Sentry fica desligado).
- **GitHub Actions:** os workflows existem em `.github/workflows`, mas ainda não foram executados no GitHub.

**Limitações:**

- Veja a tabela acima para o que não tem tela no app.
- Rate limiting atrás de proxy reverso exige habilitar `trust proxy` (desligado por padrão, de propósito).
- **Dados pessoais:** o sistema guarda dados de clientes (nome, endereço, fotos, assinatura). Ainda **não** há exclusão de conta ou de dados, política de retenção, exportação nem política de privacidade. Não use com dados reais de terceiros antes de implementá-las.
- O APK de release usa a chave de debug e não está pronto para distribuição; o APK debug serve só para desenvolvimento.

## Licença

MIT — veja [LICENSE](LICENSE). As fontes IBM Plex seguem a licença OFL (`mobile/assets/fonts/OFL-IBM-Plex.txt`).