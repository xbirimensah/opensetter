/**
 * Browser-safe part of the local CLI provider support: ids, the model-id
 * rule and the public status shape. No process spawning in here, so
 * client components can import it.
 */

export type CliProviderId = "claude-cli" | "codex-cli";

export const CLI_PROVIDER_IDS: readonly CliProviderId[] = ["claude-cli", "codex-cli"];

export function isCliProviderId(value: unknown): value is CliProviderId {
  return value === "claude-cli" || value === "codex-cli";
}

const MAX_MODEL_ID_LENGTH = 200;

/**
 * Model ids reach the CLI as an argv value. Requiring a leading letter or
 * digit and no whitespace means an id can never be parsed as a flag.
 */
export function isValidCliModelId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_MODEL_ID_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]*$/.test(value)
  );
}

export type CliModelSource = "alias" | "catalog";

export interface CliModelOption {
  id: string;
  label: string;
  /** alias: documented by the CLI's --help; catalog: listed by the CLI. */
  source: CliModelSource;
}

export type CliAuthState = "ready" | "unauthenticated" | "unknown";

export interface CliAuthStatus {
  state: CliAuthState;
  /** Login method / plan only, never account identity. */
  detail: string | null;
}

export interface CliProviderStatus {
  provider: CliProviderId;
  label: string;
  enabled: boolean;
  installed: boolean;
  version: string | null;
  auth: CliAuthStatus;
  /** Installed and enabled; auth problems are shown but do not block. */
  selectable: boolean;
  problem: string | null;
  models: CliModelOption[];
  checkedAt: string;
}

export type CliReadinessTone = "success" | "warning" | "error" | "neutral";

/** Badge for a CLI in the Models tab. */
export function describeCliReadiness(status: CliProviderStatus): { tone: CliReadinessTone; label: string } {
  if (!status.enabled) return { tone: "neutral", label: "Switched off" };
  if (!status.installed) return { tone: "error", label: "Not installed" };
  if (status.auth.state === "unauthenticated") return { tone: "warning", label: "Not signed in" };
  if (status.auth.state === "unknown") return { tone: "warning", label: "Sign-in unknown" };
  return { tone: "success", label: "Ready" };
}
