/**
 * Safety checks for the demo seed. Pure functions (no I/O), so they can be tested.
 *
 * The seed creates accounts with a public password. It must only ever touch a backend and a
 * database that live on the developer's own machine. Two things are checked, because checking one
 * is not enough: where the API is, and where the backend's database is.
 *
 * Nothing here prints or returns a password, a full URL or a host name: messages say what kind of
 * problem was found and nothing else.
 */

export class SeedRefusal extends Error {
  constructor(problems) {
    super(
      'seed:demo recusado:\n' +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\n\nOs dados de demonstração têm senha pública e só podem existir em um backend e em um ' +
        'banco da sua própria máquina.',
    );
    this.name = 'SeedRefusal';
    this.problems = problems;
  }
}

/** Case-insensitive, outer spaces ignored; empty counts as not set. */
export function canonicalNodeEnv(raw) {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase();
  return value === '' ? undefined : value;
}

// Only loopback names. Not 127.0.0.2, not 0.0.0.0, not LAN addresses, not 10.0.2.2.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** NODE_ENV of the shell running the seed. Unset is fine; anything but development/test is not. */
export function assessNodeEnv(raw) {
  const value = canonicalNodeEnv(raw);
  if (value === undefined || value === 'development' || value === 'test') return null;
  return value === 'production'
    ? 'NODE_ENV=production.'
    : 'NODE_ENV não é de desenvolvimento (use development ou deixe sem definir).';
}

export function assessApiUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return 'API_URL inválida.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'API_URL precisa ser http(s).';
  return LOCAL_HOSTS.has(url.hostname) ? null : 'API_URL não aponta para esta máquina (localhost).';
}

const OVERRIDING_PARAMS = ['host', 'hostaddr', 'socket', 'service'];

/**
 * The URL the backend uses for PostgreSQL. Local means a single loopback host. Everything that
 * could point somewhere else (several hosts, a host given as a query parameter, a socket path, no
 * host at all, a different scheme, a URL that does not parse) is refused as ambiguous.
 */
export function assessDatabaseUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return 'não encontrei o DATABASE_URL do backend, então não posso confirmar que o banco é local.';
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return 'DATABASE_URL ilegível ou ambígua (por exemplo, vários hosts).';
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    return 'DATABASE_URL não é uma URL PostgreSQL.';
  }
  if (OVERRIDING_PARAMS.some((p) => url.searchParams.has(p))) {
    return 'DATABASE_URL tem parâmetro que muda o destino (host, hostaddr, socket ou service).';
  }
  // URLs with a non-special scheme (postgresql://) keep the host exactly as typed.
  const host = url.hostname.toLowerCase();
  if (host === '') return 'DATABASE_URL sem host explícito.';
  return LOCAL_HOSTS.has(host) ? null : 'o banco de dados não é local (loopback).';
}

/**
 * How the backend really picks DATABASE_URL (checked against the installed Prisma 6.19 client,
 * @nestjs/config and dotenv 17):
 *
 *   1. A variable already in the process environment wins, even when it is empty: dotenv never
 *      overwrites an existing key. So the environment is looked at first and the files are then
 *      irrelevant.
 *   2. Otherwise the value comes from backend/.env, the only file the Prisma client loads
 *      (schemaEnvPath) and the one Nest reads when the backend runs from its own folder.
 *   3. Inside one .env file, dotenv keeps the LAST of several declarations of the same key, and a
 *      declaration can be written KEY=value or KEY: value.
 *
 * The guard reads the file with dotenv's own grammar (below) but does not rely on rule 3 to pick
 * a winner. It refuses a file that declares DATABASE_URL more than once, and it requires EVERY
 * declaration it finds to be local, so no precedence rule can lead to a non-local database.
 */

/**
 * dotenv's own line grammar, copied from the installed dotenv 17.4.1 (lib/main.js, `LINE` and
 * `parse`). A declaration is `KEY=value` OR `KEY: value` (a colon needs whitespace after it), with
 * an optional `export`, quoted or unquoted values (quotes may span several lines) and a `#` that
 * starts a comment anywhere in an unquoted value. The tests run this against the real dotenv
 * parser on thousands of generated files, so the two cannot drift apart unnoticed.
 */
const DOTENV_LINE =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;

const KEY = 'DATABASE_URL';

/** Same cleaning dotenv does to a value: trim, drop matching quotes, expand \n and \r in "...". */
function cleanValue(raw) {
  let value = (raw || '').trim();
  const maybeQuote = value[0];
  value = value.replace(/^(['"`])([\s\S]*)\1$/gm, '$2');
  if (maybeQuote === '"') {
    value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
  }
  return value;
}

/**
 * Every DATABASE_URL declaration the way dotenv reads the text, in order. The whole file is walked
 * key by key, exactly like dotenv does, so a value that spans several lines is consumed as one.
 */
export function readDeclarations(text) {
  const lines = text.replace(/\r\n?/gm, '\n');
  const values = [];
  const line = new RegExp(DOTENV_LINE.source, DOTENV_LINE.flags);
  let match;
  while ((match = line.exec(lines)) != null) {
    if (match[1] === KEY) values.push(cleanValue(match[2]));
  }
  return values;
}

/**
 * Backstop against drift between this reader and another dotenv version (Prisma bundles its own):
 * any mention of the key outside comment lines that is not one of the declarations found above
 * (an expansion such as ${DATABASE_URL}, a form this reader does not understand) makes the file
 * ambiguous, so it is refused instead of trusted.
 */
export function countUnexplainedMentions(text, declarations) {
  const mention = /(?<![\w.-])DATABASE_URL(?![\w.-])/g;
  const code = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');
  return Math.max(0, (code.match(mention) ?? []).length - declarations.length);
}

const FROM_ENV = 'variável de ambiente DATABASE_URL';

/**
 * Collects what the backend could use as DATABASE_URL.
 * @param env       process environment (an object; `process.env` in the CLI)
 * @param envFiles  [{ label, text }]; `text` is undefined when the file does not exist
 * @returns { declarations: [{ value, source }], problems: [string] }
 */
export function collectDatabaseUrls(env, envFiles = []) {
  if (Object.prototype.hasOwnProperty.call(env, 'DATABASE_URL')) {
    const value = typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL.trim() : '';
    return { declarations: [{ value, source: FROM_ENV }], problems: [] };
  }
  const declarations = [];
  const problems = [];
  for (const { label, text } of envFiles) {
    if (typeof text !== 'string') continue;
    const values = readDeclarations(text);
    if (values.length > 1) {
      problems.push(
        `${label} declara DATABASE_URL ${values.length} vezes. O dotenv usa a última, então não dá ` +
          'para ter certeza de qual banco o backend usa: deixe uma só declaração.',
      );
    }
    const unexplained = countUnexplainedMentions(text, values);
    if (unexplained > 0) {
      problems.push(
        `${label} tem ${unexplained} ocorrência(s) de DATABASE_URL que não consegui ler como ` +
          'declaração. O dotenv pode interpretá-las de outro jeito: deixe uma só declaração simples.',
      );
    }
    for (const value of values) declarations.push({ value, source: label });
  }
  return { declarations, problems };
}

/** Throws SeedRefusal listing every problem found; otherwise returns what was verified. */
export function assertSafeToSeed({ apiUrl, nodeEnv, env, envFiles }) {
  const problems = [];
  const envProblem = assessNodeEnv(nodeEnv);
  if (envProblem) problems.push(envProblem);
  const apiProblem = assessApiUrl(apiUrl);
  if (apiProblem) problems.push(apiProblem);

  const { declarations, problems: fileProblems } = collectDatabaseUrls(env, envFiles);
  problems.push(...fileProblems);

  const dbProblems = new Set();
  if (declarations.length === 0) dbProblems.add(assessDatabaseUrl(undefined));
  for (const { value } of declarations) {
    const problem = assessDatabaseUrl(value);
    if (problem) dbProblems.add(problem);
  }
  for (const problem of dbProblems) {
    problems.push(
      problem +
        ' O seed lê o DATABASE_URL da variável de ambiente ou de backend/.env, como o backend; ' +
        'se o seu backend usa outra configuração, o seed não consegue verificá-la.',
    );
  }
  if (problems.length > 0) throw new SeedRefusal(problems);
  const sources = [...new Set(declarations.map((d) => d.source))];
  return { databaseSource: sources.join(', ') };
}
