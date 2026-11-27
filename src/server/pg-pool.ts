import { errorMonitor, type EventEmitter } from "node:events";
import pg from "pg";

type QueryCallback = (error: Error | null, result?: pg.QueryResult) => void;
type DriverQuery = pg.Query & { callback?: QueryCallback; handleError(error: Error, connection: pg.Connection): void };
const serializedClients = new WeakSet<pg.Client>();

/**
 * Prisma may execute sibling relation queries concurrently inside one transaction.
 * Keep that work outside pg's deprecated client query queue. Each pool connection
 * has its own queue, so independent transactions can still execute concurrently.
 */
export function serializeClientQueries(client: pg.Client) {
  if (serializedClients.has(client)) return;
  serializedClients.add(client);
  const originalQuery = client.query.bind(client) as (query: DriverQuery, values?: unknown, callback?: QueryCallback) => unknown;
  const pending: Array<() => void> = [];
  let executing = false;
  let closed = false;

  function next() {
    if (executing) return;
    const operation = pending.shift();
    if (!operation) return;
    executing = true;
    operation();
    if (closed) {
      executing = false;
      queueMicrotask(next);
    }
  }

  // A failed SQL query calls its callback before PostgreSQL's ReadyForQuery.
  // Wait for pg's public drain event, including after timeouts, before starting
  // the next query. Waiting only for promise settlement can still overlap work.
  client.on("drain", () => { executing = false; next(); });
  function disconnected() {
    closed = true;
    executing = false;
    next();
  }
  // errorMonitor observes failures without consuming normal 'error' events.
  const events: EventEmitter = client;
  events.on(errorMonitor, disconnected);
  client.on("end", disconnected);

  client.query = ((config: string | pg.QueryConfig | pg.Submittable, values?: unknown, callback?: QueryCallback) => {
    if (config == null) throw new TypeError("Client was passed a null or undefined query");
    const submittable = typeof config === "object" && "submit" in config && typeof config.submit === "function";
    const query = (submittable ? config : new pg.Query(config as string | pg.QueryConfig, values as unknown[], callback as never)) as DriverQuery;
    if (!submittable && typeof config === "object" && "query_timeout" in config) {
      Object.defineProperty(query, "query_timeout", { value: config.query_timeout });
    }
    let result: Promise<pg.QueryResult> | undefined;
    if (!submittable) {
      if (!query.callback) {
        result = new Promise<pg.QueryResult>((resolve, reject) => {
          query.callback = (error, value) => error ? reject(error) : resolve(value!);
        }).catch((error: Error) => {
          Error.captureStackTrace(error);
          throw error;
        });
      } else if (typeof query.callback !== "function") {
        throw new TypeError("callback is not a function");
      }
    }
    let synchronous = true;
    pending.push(() => {
      try {
        // Forward custom Query/stream objects intact, including their callbacks.
        originalQuery(query, values as never, callback as never);
      } catch (error) {
        executing = false;
        queueMicrotask(next);
        if (synchronous) throw error;
        query.handleError(error as Error, client.connection);
      }
    });
    next();
    synchronous = false;
    return submittable ? query : result;
  }) as pg.Client["query"];
}

class SerializedPgClient extends pg.Client {
  constructor(config?: pg.ClientConfig) {
    super(config);
    serializeClientQueries(this);
  }
}

export function createDatabasePool(connectionString: string) {
  // PrismaPg retains pool.options when reconnecting after $disconnect(). Keep
  // the client constructor there so replacement pools retain serialization.
  return new pg.Pool({ connectionString, max: 10, Client: SerializedPgClient });
}
