import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emitKeypressEvents } from "node:readline";
import pg from "pg";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const passwordMessage = "Le mot de passe doit contenir entre 12 et 256 caractères, sans retour à la ligne.";

function validatePassword(password) {
  if (password.length < 12 || password.length > 256 || /[\0\r\n]/.test(password)) throw new Error(passwordMessage);
  return password;
}

export async function readSecretFromStdin(input) {
  const chunks = [];
  let length = 0;
  for await (const chunk of input) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    length += bytes.length;
    if (length > 4096) throw new Error(passwordMessage);
    chunks.push(bytes);
  }
  let secret;
  try { secret = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new Error(passwordMessage); }
  return validatePassword(secret.replace(/\r?\n$/, ""));
}

export function readHiddenSecret(input, output, prompt) {
  return new Promise((resolve, reject) => {
    let value = "";
    const previousRawMode = input.isRaw ?? false;
    const finish = (error) => {
      input.removeListener("keypress", onKey);
      input.removeListener("end", onEnd);
      input.removeListener("error", onError);
      input.setRawMode(previousRawMode);
      input.pause();
      output.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onEnd = () => finish(new Error("La saisie a été interrompue."));
    const onError = () => finish(new Error("Le mot de passe n’a pas pu être lu."));
    const onKey = (character, key = {}) => {
      if (key.ctrl && ["c", "d"].includes(key.name)) { finish(new Error("Initialisation interrompue.")); return; }
      if (["return", "enter"].includes(key.name)) { finish(); return; }
      if (key.name === "backspace") { value = Array.from(value).slice(0, -1).join(""); return; }
      if (!key.ctrl && !key.meta && character && !character.startsWith("\u001b")) {
        value += character;
        if (value.length > 256) finish(new Error(passwordMessage));
      }
    };
    emitKeypressEvents(input);
    input.on("keypress", onKey);
    input.once("end", onEnd);
    input.once("error", onError);
    output.write(prompt);
    input.setRawMode(true);
    input.resume();
  });
}

export async function hasExistingAdministrator(connectionString) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000, statement_timeout: 10000,
    application_name: "centre-initialisation" });
  try {
    await client.connect();
    const result = await client.query('SELECT EXISTS (SELECT 1 FROM "AdminUser") AS present, current_setting(\'TimeZone\') AS timezone');
    if (result.rows[0]?.timezone !== "Africa/Tunis") throw new Error("Le fuseau de la base doit rester Africa/Tunis avant l’initialisation.");
    return result.rows[0]?.present === true;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Le fuseau de la base")) throw error;
    throw new Error("La base n’est pas accessible ou ses migrations ne sont pas appliquées. Vérifiez la configuration avant l’initialisation.");
  } finally { await client.end().catch(() => {}); }
}

export async function executeExistingSeed(password, environment) {
  const childEnvironment = { ...environment, SEED_ADMIN_PASSWORD: password };
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"], {
        cwd: repositoryRoot, env: childEnvironment, shell: false, stdio: ["ignore", "inherit", "inherit"],
      });
      child.once("error", () => reject(new Error("L’initialisation n’a pas pu démarrer.")));
      child.once("exit", code => code === 0 ? resolve() : reject(new Error("L’initialisation a échoué. Les erreurs éventuelles doivent être corrigées avant de recommencer.")));
    });
  } finally { delete childEnvironment.SEED_ADMIN_PASSWORD; }
}

export async function initializeAdministrator(options = {}) {
  const environment = { ...(options.environment ?? process.env) };
  // Password environment variables are never accepted as an input mechanism.
  delete environment.SEED_ADMIN_PASSWORD;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const arguments_ = options.arguments ?? [];
  if (arguments_.some(argument => argument !== "--stdin") || arguments_.length > 1) throw new Error("Utilisez init-admin.mjs sans argument ou avec --stdin. Aucun mot de passe ne doit figurer dans la commande.");
  const connectionString = environment.DATABASE_URL;
  let address;
  try { address = new URL(connectionString ?? ""); } catch { throw new Error("DATABASE_URL doit être configurée avant l’initialisation."); }
  if (!["postgres:", "postgresql:"].includes(address.protocol) || !address.hostname || address.pathname.length <= 1) throw new Error("DATABASE_URL doit désigner la base PostgreSQL cible.");
  const exists = await (options.hasAdministrator ?? hasExistingAdministrator)(connectionString);
  if (exists) {
    output.write("Un administrateur existe déjà. Aucun compte, mot de passe ni paramètre n’a été modifié.\n");
    return { created: false };
  }
  let password;
  if (options.readPassword) password = validatePassword(await options.readPassword());
  else if (!arguments_.includes("--stdin") && input.isTTY && output.isTTY) {
    password = validatePassword(await readHiddenSecret(input, output, "Nouveau mot de passe administrateur (saisie masquée) : "));
    const confirmation = await readHiddenSecret(input, output, "Confirmez le mot de passe (saisie masquée) : ");
    if (password !== confirmation) throw new Error("Les deux mots de passe ne correspondent pas.");
  } else password = await readSecretFromStdin(input);
  try {
    await (options.runSeed ?? executeExistingSeed)(password, environment);
    return { created: true };
  } finally { password = ""; }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  initializeAdministrator({ arguments: process.argv.slice(2) }).catch(error => {
    console.error(error instanceof Error ? error.message : "L’initialisation a échoué.");
    process.exitCode = 1;
  });
}
