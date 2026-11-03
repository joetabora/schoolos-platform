import { getServerEnv, type LogLevel } from "@/platform/config/env";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_EXACT_KEYS = new Set([
  "pass",
  "passwd",
  "password",
  "secret",
  "authorization",
  "cookie",
  "setcookie",
  "credential",
  "credentials",
  "privatekey",
  "apikey",
  "apisecret",
  "databaseurl",
  "databaseuri",
  "connectionstring",
  "connectionuri",
  "connstring",
  "dsn",
  "sessionid",
  "sessionkey",
  "sessiontoken",
  "dbpassword",
  "databasepassword",
  "dbpass",
  "dbuser",
  "databaseuser",
  "dbusername",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "clientsecret",
  "postgresurl",
  "postgresuri",
]);

const SENSITIVE_KEY_SUFFIX =
  /(?:password|secret|token|tokens|credential|credentials|privatekey|apikey|databaseurl|databaseuri|connectionstring|sessionid)$/;

const POSTGRES_URI = /\bpostgres(?:ql)?:\/\/[^\s"'<>\\]+/gi;

/** libpq / JDBC / ADO.NET password assignments in keyword-value connection strings. */
const KEYWORD_PASSWORD =
  /(^|[\s;&])((?:password|passwd|pwd|sslpassword)\s*=\s*)(?:'[^']*'|"[^"]*"|[^\s;&]+)/gi;

export type LogFields = Record<string, unknown>;

function compactKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSensitiveKey(key: string): boolean {
  if (key === "") {
    return false;
  }
  const compact = compactKey(key);
  return SENSITIVE_EXACT_KEYS.has(compact) || SENSITIVE_KEY_SUFFIX.test(compact);
}

function redactPostgresUri(uri: string): string {
  try {
    const parsed = new URL(uri);
    const hadCredentials = parsed.username !== "" || parsed.password !== "";
    if (hadCredentials) {
      parsed.username = "redacted";
      parsed.password = "";
    }
    for (const param of ["password", "pass", "sslpassword", "pwd"]) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, "redacted");
      }
    }
    return parsed.toString();
  } catch {
    return "postgresql://[redacted]";
  }
}

/** Strip PostgreSQL credentials from unstructured log text. Other URLs are left intact. */
export function redactSensitiveText(text: string): string {
  return text.replace(POSTGRES_URI, redactPostgresUri).replace(KEYWORD_PASSWORD, "$1$2redacted");
}

function isPlainObject(value: unknown): value is LogFields {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Error)
  );
}

function redactError(error: Error): LogFields {
  const redacted: LogFields = {
    name: error.name,
    message: redactSensitiveText(error.message),
  };
  if (typeof error.stack === "string") {
    redacted["stack"] = redactSensitiveText(error.stack);
  }
  return redacted;
}

function redactValue(key: string, value: unknown): unknown {
  if (isSensitiveKey(key)) {
    return "[redacted]";
  }
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (value instanceof Error) {
    return redactError(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue("", item));
  }
  if (isPlainObject(value)) {
    return redactFields(value);
  }
  return value;
}

export function redactFields(fields: LogFields): LogFields {
  const redacted: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    redacted[key] = redactValue(key, value);
  }
  return redacted;
}

function emit(level: LogLevel, message: string, fields: LogFields = {}): void {
  const env = getServerEnv();
  if (LEVEL_ORDER[level] < LEVEL_ORDER[env.logLevel]) {
    return;
  }
  const line = JSON.stringify({
    level,
    msg: redactSensitiveText(message),
    time: new Date().toISOString(),
    appEnv: env.appEnv,
    ...redactFields(fields),
  });
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const logger = {
  debug(message: string, fields?: LogFields): void {
    emit("debug", message, fields);
  },
  info(message: string, fields?: LogFields): void {
    emit("info", message, fields);
  },
  warn(message: string, fields?: LogFields): void {
    emit("warn", message, fields);
  },
  error(message: string, fields?: LogFields): void {
    emit("error", message, fields);
  },
};
