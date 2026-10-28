export const ExitCode = {
  Success: 0,
  /** The command was understood but could not be completed (e.g. a filesystem problem). */
  Failure: 1,
  /** The command line itself was wrong: unknown command, missing or invalid argument. */
  Usage: 2
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** An expected error whose message is safe to show to the user as-is. */
export class CliError extends Error {
  readonly exitCode: ExitCodeValue;

  constructor(message: string, exitCode: ExitCodeValue = ExitCode.Failure) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export function usageError(message: string): CliError {
  return new CliError(`${message}\nRun "likha help" to see available commands.`, ExitCode.Usage);
}
