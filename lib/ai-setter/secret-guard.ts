/**
 * Last line of defence for model output: a DM can try to talk the model
 * into repeating secrets. Whatever slipped past the prompt and the CLI
 * sandbox, a draft that carries secret material is redacted and never
 * auto-sent.
 */

type EnvMap = Record<string, string | undefined>;

const SECRET_ENV_NAME = /(SECRET|KEY|TOKEN|PASSWORD|DATABASE_URL|REDIS_URL)/i;
const MIN_SECRET_LENGTH = 12;

/** Key and token shapes from the providers this server talks to. */
const TOKEN_SHAPES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/,
  /\b(IGAA|IGQV|EAA)[A-Za-z0-9]{30,}/,
  /\bre_[A-Za-z0-9_]{20,}/,
  /\b(ghp|gho|github_pat)_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bpostgres(ql)?:\/\/[^\s:]+:[^\s@]+@/i,
];
/** Long unbroken base64/hex runs (keys, hashes) outside of links. */
const LONG_OPAQUE_RUN = /[A-Za-z0-9+/=_-]{40,}/;
const URL_PATTERN = /https?:\/\/\S+/gi;

function secretEnvValues(env: EnvMap = process.env): string[] {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_ENV_NAME.test(name) && value && value.length >= MIN_SECRET_LENGTH)
    .map(([, value]) => value as string);
}

export function containsSecretMaterial(text: string, env: EnvMap = process.env): boolean {
  if (!text) return false;
  if (secretEnvValues(env).some((value) => text.includes(value))) return true;
  if (TOKEN_SHAPES.some((shape) => shape.test(text))) return true;
  return LONG_OPAQUE_RUN.test(text.replace(URL_PATTERN, " "));
}

/** Replace known secret values so they can't be sent even by an approving human. */
export function redactSecretValues(text: string, env: EnvMap = process.env): string {
  let out = text;
  for (const value of secretEnvValues(env)) out = out.split(value).join("[removed]");
  for (const shape of TOKEN_SHAPES) out = out.replace(new RegExp(shape.source, shape.flags.includes("g") ? shape.flags : `${shape.flags}g`), "[removed]");
  return out;
}
