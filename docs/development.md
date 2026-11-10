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
# edite DATABASE_URL e JWT_ACCESS_SECRET em .env
npx prisma migrate deploy
npm run start:dev
```

Verificação completa:

```powershell
npx prettier --check 'src/**/*.ts' 'test/**/*.ts'
npx eslint '{src,test}/**/*.ts'
npm run build
npm test              # unitários
npm run test:e2e      # integração com PostgreSQL real (usa servicecheck_test)
```

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

## Git

Os commits usam apenas a sua identidade Git. Antes de publicar:

```powershell
git log --format='%h %an <%ae> %cn <%ce> %s'
git log --all --format=%B | Select-String -Pattern 'Co-authored'
```