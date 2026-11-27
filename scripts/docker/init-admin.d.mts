import type { Readable, Writable } from "node:stream";

export function readSecretFromStdin(input: Readable): Promise<string>;
export function readHiddenSecret(input: NodeJS.ReadStream, output: NodeJS.WriteStream, prompt: string): Promise<string>;
export function hasExistingAdministrator(connectionString: string): Promise<boolean>;
export function executeExistingSeed(password: string, environment: NodeJS.ProcessEnv): Promise<void>;
export function initializeAdministrator(options?: {
  environment?: NodeJS.ProcessEnv;
  input?: Readable;
  output?: Writable;
  arguments?: string[];
  hasAdministrator?: (connectionString: string) => Promise<boolean>;
  readPassword?: () => Promise<string>;
  runSeed?: (password: string, environment: NodeJS.ProcessEnv) => Promise<void>;
}): Promise<{ created: boolean }>;
