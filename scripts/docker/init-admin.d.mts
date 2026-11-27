import type { Readable, Writable } from "node:stream";
type Environment = Record<string, string | undefined>;

export function readSecretFromStdin(input: Readable): Promise<string>;
export function readHiddenSecret(input: NodeJS.ReadStream, output: NodeJS.WriteStream, prompt: string): Promise<string>;
export function hasExistingAdministrator(connectionString: string): Promise<boolean>;
export function executeExistingSeed(password: string, environment: Environment): Promise<void>;
export function initializeAdministrator(options?: {
  environment?: Environment;
  input?: Readable;
  output?: Writable;
  arguments?: string[];
  hasAdministrator?: (connectionString: string) => Promise<boolean>;
  readPassword?: () => Promise<string>;
  runSeed?: (password: string, environment: Environment) => Promise<void>;
}): Promise<{ created: boolean }>;
