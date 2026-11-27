import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { serializeClientQueries } from "@/server/pg-pool";

type DriverQuery = pg.Query & { text?: string; values?: unknown[]; callback?: (error: Error | null, result?: pg.QueryResult) => void };
const result = (value: number): pg.QueryResult => ({ command: "SELECT", rowCount: 1, oid: 0, fields: [], rows: [{ value }] });

function connection() {
  const client = new pg.Client();
  const submitted: DriverQuery[] = [];
  let connectionError: Error | undefined;
  const rawQuery = vi.fn((query: DriverQuery, values?: unknown, callback?: DriverQuery["callback"]) => {
    query.callback ??= typeof values === "function" ? values as DriverQuery["callback"] : callback;
    submitted.push(query);
    if (connectionError) queueMicrotask(() => query.callback?.(connectionError!));
    return query;
  });
  client.query = rawQuery as unknown as pg.Client["query"];
  serializeClientQueries(client);
  function complete(index: number, value = index, error: Error | null = null, drain = true) {
    submitted[index].callback?.(error, error ? undefined : result(value));
    if (drain) client.emit("drain");
  }
  return { client, rawQuery, submitted, complete, breakConnection(error: Error) {
    connectionError = error;
    client.emit("error", error);
    submitted[0].callback?.(error);
  } };
}

describe("Sérialisation des requêtes PostgreSQL par connexion", () => {
  it("exécute les relations concurrentes dans leur ordre sans remplir la file pg", async () => {
    const c = connection();
    const pending = [0, 1, 2, 3].map(value => c.client.query("SELECT $1", [value]));
    expect(c.rawQuery).toHaveBeenCalledTimes(1);
    for (let index = 0; index < pending.length; index++) {
      expect(c.submitted[index].values).toEqual([index]);
      c.complete(index);
      expect(c.rawQuery).toHaveBeenCalledTimes(Math.min(index + 2, pending.length));
    }
    expect((await Promise.all(pending)).map(value => value.rows[0].value)).toEqual([0, 1, 2, 3]);
  });

  it("préserve les callbacks, paramètres et résultats en mode tableau", () => {
    const c = connection();
    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();
    expect(c.client.query("SELECT 1", first)).toBeUndefined();
    const config: pg.QueryArrayConfig & { query_timeout: number } = { text: "SELECT $1", rowMode: "array", values: [2], query_timeout: 500 };
    expect(c.client.query(config, second)).toBeUndefined();
    expect(c.client.query("SELECT $1", [3], third)).toBeUndefined();
    c.complete(0, 1);
    expect(c.submitted[1]).toMatchObject({ text: "SELECT $1", values: [2], _rowMode: "array", query_timeout: 500 });
    c.complete(1, 2);
    c.complete(2, 3);
    expect(first).toHaveBeenCalledExactlyOnceWith(null, result(1));
    expect(second).toHaveBeenCalledExactlyOnceWith(null, result(2));
    expect(third).toHaveBeenCalledExactlyOnceWith(null, result(3));
  });

  it("attend ReadyForQuery après une erreur avant la requête suivante", async () => {
    const c = connection();
    const error = new Error("division by zero");
    const failed = c.client.query("SELECT 1 / 0");
    const rejection = expect(failed).rejects.toBe(error);
    const next = c.client.query("ROLLBACK");
    c.complete(0, 0, error, false);
    await rejection;
    expect(c.rawQuery).toHaveBeenCalledTimes(1);
    c.client.emit("drain");
    expect(c.submitted[1].text).toBe("ROLLBACK");
    c.complete(1);
    await next;
  });

  it("propage une déconnexion aux requêtes en attente et aux écouteurs existants", async () => {
    const c = connection();
    const observed = vi.fn();
    c.client.on("error", observed);
    const error = new Error("connection lost");
    const pending = [0, 1, 2].map(() => c.client.query("SELECT 1"));
    const results = Promise.allSettled(pending);
    c.breakConnection(error);
    expect((await results).map(value => value.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(observed).toHaveBeenCalledExactlyOnceWith(error);
    expect(c.rawQuery).toHaveBeenCalledTimes(3);
  });

  it("ne masque pas une erreur de connexion sans écouteur", () => {
    const c = connection();
    const error = new Error("unhandled connection failure");
    expect(() => c.client.emit("error", error)).toThrow(error);
  });

  it("conserve les erreurs de validation synchrones et les objets Query", () => {
    const c = connection();
    expect(() => c.client.query(null as unknown as string)).toThrow("null or undefined query");
    const invalid = { text: "SELECT 1", callback: "invalid" };
    expect(() => c.client.query(invalid)).toThrow("callback is not a function");
    const callback = vi.fn();
    const query = new pg.Query("SELECT 1", callback);
    expect(c.client.query(query)).toBe(query);
    expect(c.submitted[0]).toBe(query);
    c.complete(0);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("garde les autres connexions disponibles et ne double pas la sérialisation", async () => {
    const first = connection();
    const second = connection();
    serializeClientQueries(first.client);
    const pending = [first.client.query("BEGIN"), first.client.query("COMMIT"), second.client.query("SELECT 1")];
    expect(first.rawQuery).toHaveBeenCalledTimes(1);
    expect(second.rawQuery).toHaveBeenCalledTimes(1);
    second.complete(0);
    first.complete(0);
    first.complete(1);
    await Promise.all(pending);
    expect(first.rawQuery).toHaveBeenCalledTimes(2);
  });
});
