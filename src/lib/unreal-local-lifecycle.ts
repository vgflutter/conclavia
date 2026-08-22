import "server-only";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const START_TIMEOUT_MS = 12 * 60 * 1_000;
const MAX_DIAGNOSTIC_LENGTH = 16_000;

interface LifecycleGlobals {
  __conclaviaUnrealStart?: Promise<void>;
}

const lifecycleGlobals = globalThis as typeof globalThis & LifecycleGlobals;

export function isLocalUnrealLifecycleEnabled(): boolean {
  return process.env.CONCLAVIA_LOCAL_STUDIO_LIFECYCLE?.trim() === "true";
}

function appendDiagnostic(current: string, chunk: Buffer | string): string {
  const next = `${current}${chunk.toString()}`;
  return next.length <= MAX_DIAGNOSTIC_LENGTH
    ? next
    : next.slice(-MAX_DIAGNOSTIC_LENGTH);
}

function runStartScript(): Promise<void> {
  const script = resolve(process.cwd(), "scripts/start-3d-studio.sh");
  if (!existsSync(script)) {
    return Promise.reject(
      new Error("Lifecycle Unreal locale non installato in questo ambiente."),
    );
  }

  return new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("/bin/bash", [script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AWS_PROFILE:
          process.env.CONCLAVIA_AWS_PROFILE?.trim() || "conclavia-studio",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("Avvio della GPU Unreal scaduto dopo 12 minuti."));
    }, START_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendDiagnostic(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendDiagnostic(stderr, chunk);
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      const diagnostic = (stderr || stdout)
        .replace(/\s+/gu, " ")
        .trim()
        .slice(-1_000);
      finish(
        new Error(
          diagnostic ||
            `Avvio Unreal terminato con ${signal ? `segnale ${signal}` : `codice ${code ?? "sconosciuto"}`}.`,
        ),
      );
    });
  });
}

export function startLocalUnrealInfrastructure(): Promise<void> {
  if (!isLocalUnrealLifecycleEnabled()) {
    return Promise.reject(
      new Error("Lifecycle automatico Unreal disabilitato in questo ambiente."),
    );
  }
  lifecycleGlobals.__conclaviaUnrealStart ??= runStartScript().finally(() => {
    lifecycleGlobals.__conclaviaUnrealStart = undefined;
  });
  return lifecycleGlobals.__conclaviaUnrealStart;
}
