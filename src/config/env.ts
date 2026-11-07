/**
 * Validated, typed access to environment variables.
 * Fails fast at boot instead of surfacing `undefined` deep inside a request.
 */
import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value.trim() === "" ? fallback : value;
}

export const env = {
  NODE_ENV: optional("NODE_ENV", "development"),
  PORT: Number(optional("PORT", "8000")),
  DATABASE_URL: required("DATABASE_URL"),
  JWT_SECRET: required("JWT_SECRET"),
  JWT_EXPIRES_IN: optional("JWT_EXPIRES_IN", "7d"),
  GEMINI_API_KEY: required("GEMINI_API_KEY"),
  GEMINI_MODEL: optional("GEMINI_MODEL", "gemini-3.5-flash-lite"),
} as const;

export const isProduction = env.NODE_ENV === "production";

if (!Number.isInteger(env.PORT) || env.PORT < 1 || env.PORT > 65535) {
  throw new Error(`Invalid PORT: ${env.PORT}`);
}
