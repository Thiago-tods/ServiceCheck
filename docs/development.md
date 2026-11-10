# Desenvolvimento (Windows / PowerShell)

Pré-requisitos: Node.js 22+, PostgreSQL 16+ (ou um cluster local descartável, abaixo), Flutter estável com Android SDK.

## Banco de dados local

Se você já tem um PostgreSQL, crie os bancos `servicecheck_dev` e `servicecheck_test`.
Para um cluster descartável só para este projeto (porta 54329, sem senha, apenas `localhost`):

```powershell
$bin = 'C:\Program Files\PostgreSQL\17\bin'
$data = "$env:LOCALAPPDATA\servicecheck-pg"
& "$bin\initdb.exe" -D $data -U postgres -A trust -E UTF8 --locale=C
& "$bin\pg_ctl.exe" -D $data -o '-p 54329' -l "$data\server.log" start
& "$bin\createdb.exe" -h localhost -p 54329 -U postgres servicecheck_dev
& "$bin\createdb.exe" -h localhost -p 54329 -U postgres servicecheck_test
```

> `trust` é aceitável apenas num cluster local que escuta em `localhost`. Nunca use isso em servidor.

## Backend

```powershell
cd backend
npm install
Copy-Item .env.example .env
# edite DATABASE_URL e JWT_ACCESS_SECRET em .env (veja "Segredo JWT" abaixo)
npx prisma migrate deploy
npm run start:dev
```

Com o cluster descartável acima, `DATABASE_URL` é `postgresql://postgres@localhost:54329/servicecheck_dev?schema=public`.

### Segredo JWT

`JWT_ACCESS_SECRET` assina os tokens de acesso. Gere um valor aleatório e cole em `backend/.env`:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

O valor de `.env.example` é só um marcador. A política vale em **todos** os ambientes, exceto em `NODE_ENV=development` explícito, que só avisa. **Defina `NODE_ENV=production` nos servidores.**

| `NODE_ENV` | Marcador ou segredo fora da política | Segredo aleatório |
|---|---|---|
| `development` | inicia, com um aviso (que não mostra o valor) | inicia |
| `production` (em qualquer caixa: `Production`, `PRODUCTION`) | **recusa iniciar**, dizendo o motivo (nunca o valor) | inicia |
| ausente ou vazio | **recusa iniciar**, como em produção (falha segura: um servidor que esqueceu a variável nunca aceita um marcador) | inicia |
| `test` (em qualquer caixa) | **recusa iniciar**, como em produção: testes e CI precisam fornecer um segredo válido (`backend/test/env.ts` deriva um) | inicia |

Qualquer outro valor (`prod`, `staging`...) é inválido e a API não inicia. `NODE_ENV` é comparado sem diferenciar maiúsculas e minúsculas.

Em produção, o segredo precisa ser:

- **hexadecimal com pelo menos 64 caracteres**, ou **base64/base64url com pelo menos 43** (256 bits ou mais; no base64, com pelo menos 3 tipos de caractere entre minúsculas, maiúsculas, dígitos e `-_+/`);
- e **não pode** conter marcadores ou palavras comuns (`change-me`, `replace-me`, `example`, `secret`, `password`...), ser uma unidade repetida (`abcabcabc...`), ter 8 caracteres iguais ou consecutivos seguidos (`aaaaaaaa`, `abcdefgh`, `01234567`), ter poucos caracteres distintos, nem usar caracteres fora de hex/base64 (espaços internos, acentos, pontuação).

Espaços nas pontas são ignorados ao avaliar o segredo, mas o valor usado **não é alterado**. A regra verifica formato, tamanho e padrões proibidos; **não mede entropia**, então passar nela não prova que o valor é aleatório: gere-o com o comando acima. Os segredos feitos por esse comando, ou por `openssl rand -hex 32`, passam. Segredos mais curtos ou em outro formato são recusados em produção, e nada é trocado automaticamente.

> O cliente Prisma carrega `backend/.env` ao ser importado, então um `NODE_ENV` escrito nesse arquivo conta como definido. Nunca versione o seu `.env` (já está no `.gitignore`).

### Dados de demonstração (somente desenvolvimento)

Para ter algo para ver no app logo após clonar, com o backend rodando **na sua máquina**:

```powershell
cd backend
npm run seed:demo
```

O script cria, pela API, dados fictícios: a empresa "Demo Serviços Técnicos", um Owner, um técnico, um cliente com endereço, um serviço com checklist e duas ordens agendadas para o técnico.

| Conta | E-mail | Senha |
|---|---|---|
| Owner | `owner@demo.servicecheck.test` | `Demo-Only-Passw0rd!` |
| Técnico | `tecnico@demo.servicecheck.test` | `Demo-Only-Passw0rd!` |

> **Esta senha é pública** (está neste repositório). Nunca crie essas contas num servidor ou banco que outras pessoas acessem.

**Proteções do seed.** Antes de criar qualquer coisa, ele confere **a API e o banco do backend**, e para se não tiver certeza:

- `NODE_ENV` do terminal (sem diferenciar caixa) precisa estar ausente, `development` ou `test`; `production` e qualquer outro valor são recusados.
- A API (`API_URL`) precisa ser `localhost`, `127.0.0.1` ou `[::1]`. Não valem `127.0.0.2`, `0.0.0.0`, IPs da rede nem `10.0.2.2`.
- O banco: o seed segue a precedência real do backend para o `DATABASE_URL`. Uma **variável de ambiente do processo vence** (mesmo vazia: o dotenv nunca sobrescreve uma variável existente), e então o arquivo nem é consultado. Sem variável, vale `backend/.env`, o único arquivo que o cliente Prisma carrega. O seed lê o arquivo com a **mesma gramática do dotenv instalado**, inclusive `DATABASE_URL: valor` (com dois-pontos), além de `DATABASE_URL=valor`; os testes o comparam com o dotenv real em dezenas de milhares de arquivos gerados. O dotenv usa a **última** de várias declarações no mesmo arquivo, então o seed **recusa um `.env` com mais de uma declaração** de `DATABASE_URL` em vez de adivinhar qual vale, recusa também qualquer outra ocorrência do nome que não consiga ler como declaração (por exemplo `${DATABASE_URL}`), e exige que toda declaração encontrada seja **um único host de loopback** (`localhost`, `127.0.0.1` ou `[::1]`). Recusa host externo, IP de rede, vários hosts, URL com `host=`, `hostaddr=` ou socket, esquema que não seja PostgreSQL, URL ilegível ou não encontrada. As mensagens nunca mostram senha, URL nem nome de host.
- O resumo final **não mostra o endereço da API** (só "local"), e nada que venha da URL, como usuário ou senha, aparece na saída, nem em caso de erro.
- As mensagens de erro mostram só a rota, o status HTTP e uma explicação genérica: o **corpo da resposta nunca é impresso**, nem tokens, cabeçalhos ou senhas que um servidor coloque nele.
- Só usa `GET` e `POST`: nada é apagado nem sobrescrito. Cada chamada tem limite de 10 s, **inclusive durante a leitura do corpo da resposta**: um servidor que envia os cabeçalhos e trava termina com uma mensagem clara, sem stack trace e sem mostrar endereço, token ou senha.

**O que ele não consegue verificar:** se o seu backend usa um `DATABASE_URL` diferente do que o seed enxerga (definido só no terminal onde o backend roda, por exemplo), ou se `localhost` é um túnel ou *port-forward* para um servidor remoto. Rode o seed na mesma configuração do backend e confira o `DATABASE_URL` antes.

**Rodar de novo, ou depois de uma interrupção.** Cada passo procura o que já existe (por e-mail, nome ou título) e só cria o que falta, então repetir não duplica nada e uma execução interrompida (rede, erro do servidor, Ctrl+C) é **completada pela próxima**, sem limpar nada. As listas de clientes e de ordens são lidas **página a página** (200 por vez, o máximo que a API aceita), então um registro além da primeira página também é encontrado. Se a leitura falhar, ou a paginação vier inválida ou inconsistente, o seed **para sem criar nada com base numa busca incompleta**. O resumo final diz quantos itens foram criados, ou que tudo já estava completo.

- Outra porta ou endereço local: `$env:API_URL = 'http://localhost:3100/api/v1'; npm run seed:demo`.
- No app, entre com o técnico para executar as ordens; entre com o Owner para aprovar uma execução finalizada (o Owner não pode ter participado dela).
- Os testes do seed rodam com `npm run test:seed` e também no fluxo completo de `npm test` (veja "Verificação completa").

**Limpar e recriar os dados de demonstração.** Os dois caminhos **apagam todo o banco** apontado por `DATABASE_URL`; confira que é o banco de desenvolvimento.

```powershell
# Opção 1: o Prisma recria o banco e pede confirmação
npx prisma migrate reset

# Opção 2: recriar manualmente no cluster descartável (pare o backend antes)
$bin = 'C:\Program Files\PostgreSQL\17\bin'
& "$bin\dropdb.exe" -h localhost -p 54329 -U postgres servicecheck_dev
& "$bin\createdb.exe" -h localhost -p 54329 -U postgres servicecheck_dev
npx prisma migrate deploy
```

Depois, inicie o backend e rode `npm run seed:demo` de novo. (A Opção 2 foi verificada; a Opção 1 é o comando padrão do Prisma, não foi executada na verificação deste guia.)

Verificação completa:

```powershell
npm run format        # verifica formatação (não altera arquivos); 'npm run format:fix' corrige
npm run lint          # verifica lint (não altera arquivos); 'npm run lint:fix' corrige
npm run build
npm test              # unitários (Jest) e, em seguida, os testes do seed (hook posttest)
npm run test:e2e      # integração com PostgreSQL real (usa servicecheck_test)
```

`npm test -- <filtro>` repassa o filtro ao Jest (por exemplo, `npm test -- env.validation`); depois dele os testes do seed rodam por inteiro. Para rodar só os do seed (verificação de sintaxe e `node:test`): `npm run test:seed`. A CI executa `npm test`, então roda os dois conjuntos.

O Helmet está ativo. `trust proxy` fica desligado de propósito: sem um proxy reverso confiável, confiar em `X-Forwarded-For` deixaria qualquer cliente falsificar o IP e burlar o rate limit. Ao colocar a API atrás de um proxy conhecido, habilite-o com o número exato de saltos.

Os testes e2e aplicam as migrações e esvaziam as tabelas do banco de teste a cada teste.
Variáveis de teste ficam em `backend/test/env.ts`; na CI, `DATABASE_URL` vem do ambiente.

### Armazenamento de arquivos

`STORAGE_DRIVER=local` grava em `STORAGE_LOCAL_DIR`. Para S3 ou compatível (MinIO, R2...), use `STORAGE_DRIVER=s3` e as variáveis `S3_*` de `.env.example`.

## Mobile

```powershell
cd mobile
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter gen-l10n
flutter analyze
flutter test
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

`10.0.2.2` é o endereço do computador visto pelo emulador Android. Em aparelho físico, use o IP da máquina na rede.
Builds de debug aceitam HTTP; builds de release exigem HTTPS.

### Gerar e instalar o APK (debug)

A URL da API é fixada **na hora do build** por `--dart-define=API_BASE_URL=...` (padrão: `http://10.0.2.2:3000/api/v1`). Para trocar o endereço, gere o APK de novo.

```powershell
cd mobile
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter gen-l10n
flutter build apk --debug --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

O APK sai em `mobile\build\app\outputs\flutter-apk\app-debug.apk` (cerca de 180 MB, por ser um build de debug).

Instalar num emulador Android já iniciado (`flutter emulators` lista os disponíveis; `flutter emulators --launch <id>` inicia um):

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb devices
& $adb install -r build\app\outputs\flutter-apk\app-debug.apk
```

Ou, com o emulador aberto, `flutter run` instala e abre o app direto.

Para o app falar com o backend:

- O backend precisa estar rodando na sua máquina (`npm run start:dev`, porta 3000) e o banco acessível a ele.
- No emulador, `10.0.2.2` aponta para o `localhost` do computador. O endereço `localhost` dentro do emulador é o próprio emulador, não funciona.
- Em aparelho físico, use o IP do computador na rede (`--dart-define=API_BASE_URL=http://192.168.x.x:3000/api/v1`), com celular e computador na mesma rede e o firewall liberando a porta 3000.
- HTTP só funciona em builds de debug (o manifest de debug permite tráfego sem criptografia; o de release não).

> Este é um APK **de desenvolvimento**. O build de release usa a chave de debug (`mobile/android/app/build.gradle.kts` ainda tem a configuração de assinatura pendente) e **não está pronto para distribuição**. Não publique nem compartilhe um APK de release gerado a partir deste repositório.

## Git

Os commits usam apenas a sua identidade Git. Antes de publicar:

```powershell
git log --format='%h %an <%ae> %cn <%ce> %s'
git log --all --format=%B | Select-String -Pattern 'Co-authored'
```