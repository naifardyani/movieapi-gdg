/**
 * Integration-test helpers.
 *
 * Tests bind the real Express app to an ephemeral port (0) so requests travel
 * through the full stack: route matching, middleware order, validation,
 * controllers, services, Prisma and PostgreSQL. Nothing is mocked.
 *
 * A fresh server per test file keeps files independent; `--test-concurrency=1`
 * keeps database writes from different files apart.
 */
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../../src/app.js";
import { prisma } from "../../src/config/prisma.js";

export type TestServer = {
  /** Service root, e.g. http://127.0.0.1:41234 */
  origin: string;
  /** API root, e.g. http://127.0.0.1:41234/api */
  baseUrl: string;
  close: () => Promise<void>;
};

export async function startServer(): Promise<TestServer> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server did not expose a port");
  }

  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    baseUrl: `${origin}/api`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await prisma.$disconnect();
    },
  };
}

/* -------------------------------------------------------------------------- */
/*                                 HTTP client                                */
/* -------------------------------------------------------------------------- */

export type ApiResponse<T = unknown> = {
  status: number;
  body: T;
  text: string;
};

export type RequestOptions = {
  token?: string;
  headers?: Record<string, string>;
  /** Sent verbatim instead of a JSON body (malformed JSON, oversize bodies). */
  raw?: string;
};

export type ApiClient = ReturnType<typeof createClient>;

export function createClient(baseUrl: string) {
  async function request(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<ApiResponse> {
    const headers: Record<string, string> = { ...options.headers };
    let payload: string | undefined;

    if (options.raw !== undefined) {
      payload = options.raw;
      headers["Content-Type"] ??= "application/json";
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }

    if (options.token !== undefined) {
      headers["Authorization"] = `Bearer ${options.token}`;
    }

    const response = await fetch(baseUrl + path, { method, headers, body: payload });
    const text = await response.text();

    let parsed: unknown = null;
    if (text !== "") {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    return { status: response.status, body: parsed as never, text };
  }

  return {
    request,
    get: (path: string, options?: RequestOptions) => request("GET", path, undefined, options),
    post: (path: string, body?: unknown, options?: RequestOptions) =>
      request("POST", path, body, options),
    delete: (path: string, options?: RequestOptions) =>
      request("DELETE", path, undefined, options),
  };
}

/* -------------------------------------------------------------------------- */
/*                                  Fixtures                                  */
/* -------------------------------------------------------------------------- */

export type TestUser = {
  id: string;
  email: string;
  password: string;
  username: string;
  token: string;
};

export function uniqueEmail(prefix = "user"): string {
  return `${prefix}-${randomUUID()}@test.local`;
}

/**
 * Registers then logs in.
 *
 * Registration intentionally returns no token, so this mirrors what a real
 * client does instead of reaching into the database for a shortcut.
 */
export async function createUser(
  api: ApiClient,
  overrides: { email?: string; password?: string; username?: string } = {},
): Promise<TestUser> {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? "secret123";
  const username = overrides.username ?? "Test User";

  const registered = await api.post("/auth/register", { email, password, username });
  if (registered.status !== 201) {
    throw new Error(`registration failed (${registered.status}): ${registered.text}`);
  }

  const login = await api.post("/auth/login", { email, password });
  if (login.status !== 200) {
    throw new Error(`login failed (${login.status}): ${login.text}`);
  }

  const { token, user } = login.body as { token: string; user: { id: string } };

  return { id: user.id, email, password, username, token };
}

/** Removes a user; cascades delete their watchlist rows and reviews. */
export async function deleteUser(id: string): Promise<void> {
  await prisma.user.deleteMany({ where: { id } });
}
