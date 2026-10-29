import {
  ORIGIN_API_KEY_PATTERN,
  fail,
  ok,
  type CredentialVault,
  type OriginConnectionState,
  type OriginCredential,
  type OriginIdentity,
  type OriginTransport,
  type OriginUnauthorizedReason,
  type Result
} from "@studio/contracts";

export interface OriginConnectionDeps {
  transport: OriginTransport;
  vault: CredentialVault;
  onChange(state: OriginConnectionState): void;
  /** Log lines never contain the credential; implementations receive text only. */
  log(message: string): void;
  now?: () => Date;
}

const NO_SERVER = "No ORIGIN server is configured for this build. Set the ORIGIN transport in origin.json or ORIGIN_STUDIO_ORIGIN_TRANSPORT.";

function reasonFrom(message: string): OriginUnauthorizedReason {
  const lower = message.toLowerCase();
  if (lower.includes("expired")) return "expired";
  if (lower.includes("revoked") || lower.includes("not active")) return "revoked";
  if (lower.includes("forbid") || lower.includes("permission")) return "forbidden";
  return "invalid";
}

/**
 * The connection lifecycle: explicit connect and disconnect, credential kept
 * only after ORIGIN accepted it, forgotten as soon as ORIGIN rejects it, and
 * an honest "unavailable" (credential kept, nothing else changes) when ORIGIN
 * cannot be reached. Every transition is reported through `onChange`.
 */
export class OriginConnection {
  private current: OriginConnectionState = { state: "disconnected", detail: "Not connected to ORIGIN." };
  private credential: OriginCredential | null = null;
  private lastConnectedAt: string | null = null;
  private readonly now: () => Date;
  private sequence = 0;

  constructor(private readonly deps: OriginConnectionDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  get state(): OriginConnectionState {
    return this.current;
  }

  /** Host-only: the credential for requests on the user's behalf, or null. */
  credentialForRequests(): OriginCredential | null {
    return this.credential;
  }

  private setState(state: OriginConnectionState): void {
    this.current = state;
    this.deps.onChange(state);
  }

  /** At start-up: picks up a stored credential and verifies it. Never throws. */
  async restore(): Promise<void> {
    if (this.deps.transport.kind === "none") {
      this.setState({ state: "disconnected", detail: NO_SERVER });
      return;
    }
    let stored: string | null = null;
    try {
      stored = await this.deps.vault.load();
    } catch (error) {
      this.deps.log(`Could not read the stored ORIGIN credential: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (stored === null) {
      this.setState({ state: "disconnected", detail: "Not connected to ORIGIN." });
      return;
    }
    if (!ORIGIN_API_KEY_PATTERN.test(stored)) {
      await this.deps.vault.clear().catch(() => undefined);
      this.setState({ state: "disconnected", detail: "The stored ORIGIN credential was unreadable and has been removed." });
      return;
    }
    this.credential = { kind: "api-key", secret: stored };
    await this.verify("restore");
  }

  /** Verifies a credential typed by the user; stores it only when ORIGIN accepted it. */
  async connect(secret: string): Promise<Result<OriginIdentity>> {
    if (this.deps.transport.kind === "none") {
      this.setState({ state: "disconnected", detail: NO_SERVER });
      return fail("NOT_CONNECTED", NO_SERVER);
    }
    if (typeof secret !== "string" || !ORIGIN_API_KEY_PATTERN.test(secret.trim())) {
      return fail("INVALID_ARGUMENT", "An ORIGIN API key is 64 hexadecimal characters.");
    }
    const credential: OriginCredential = { kind: "api-key", secret: secret.trim() };
    const sequence = ++this.sequence;
    this.setState({ state: "connecting" });
    const result = await this.deps.transport.whoAmI(credential);
    if (sequence !== this.sequence) {
      return fail("UNAVAILABLE", "The connection changed while verifying; try again.");
    }
    if (!result.ok) {
      this.applyFailure(result.error.code, result.error.message, false);
      return result;
    }
    if (!result.value.permissions.includes("read")) {
      this.setState({ state: "unauthorized", reason: "forbidden", detail: "The credential grants no read access, so LIKHA cannot use it." });
      return fail("FORBIDDEN", "The credential grants no read access, so LIKHA cannot use it.");
    }
    this.credential = credential;
    const saved = await this.deps.vault.save(credential.secret);
    if (!saved.ok) {
      this.deps.log(`ORIGIN credential verified but not stored: ${saved.error.message}`);
    }
    this.markConnected(result.value);
    this.deps.log(`Connected to ORIGIN as ${result.value.displayName} via ${this.deps.transport.kind} (${this.deps.transport.target})${saved.ok ? "" : "; credential kept for this session only"}`);
    return ok(result.value);
  }

  /** Forgets the credential, locally and at rest. ORIGIN is not told (keys are revoked in ORIGIN). */
  async disconnect(): Promise<void> {
    this.sequence++;
    this.credential = null;
    await this.deps.vault.clear().catch((error: unknown) => this.deps.log(`Could not clear the stored ORIGIN credential: ${error instanceof Error ? error.message : String(error)}`));
    this.setState({ state: "disconnected", detail: "Disconnected from ORIGIN." });
    this.deps.log("Disconnected from ORIGIN.");
  }

  /** Re-verifies the stored credential, e.g. after being offline. */
  async refresh(): Promise<OriginConnectionState> {
    if (!this.credential) {
      if (this.current.state !== "disconnected" && this.current.state !== "unauthorized") {
        this.setState({ state: "disconnected", detail: "Not connected to ORIGIN." });
      }
      return this.current;
    }
    await this.verify("refresh");
    return this.current;
  }

  private async verify(cause: "restore" | "refresh"): Promise<void> {
    const credential = this.credential;
    if (!credential) return;
    const sequence = ++this.sequence;
    this.setState({ state: "connecting" });
    const result = await this.deps.transport.whoAmI(credential);
    if (sequence !== this.sequence || this.credential !== credential) return;
    if (result.ok) {
      this.markConnected(result.value);
      if (cause === "restore") this.deps.log(`Connected to ORIGIN as ${result.value.displayName} (stored credential).`);
      return;
    }
    this.applyFailure(result.error.code, result.error.message, true);
  }

  private markConnected(identity: OriginIdentity): void {
    this.lastConnectedAt = this.now().toISOString();
    this.setState({ state: "connected", identity, verifiedAt: this.lastConnectedAt, transport: this.deps.transport.kind });
  }

  /** A failed verification: a rejected credential is forgotten; an unreachable ORIGIN keeps it. */
  private applyFailure(code: string, message: string, stored: boolean): void {
    if (code === "UNAUTHORIZED" || code === "FORBIDDEN") {
      const reason = code === "FORBIDDEN" ? "forbidden" : reasonFrom(message);
      this.credential = null;
      if (stored) void this.deps.vault.clear().catch(() => undefined);
      this.setState({ state: "unauthorized", reason, detail: message });
      this.deps.log(`ORIGIN rejected the credential (${reason}); it has been forgotten.`);
      return;
    }
    this.setState({ state: "unavailable", detail: message, lastConnectedAt: this.lastConnectedAt });
    this.deps.log(`ORIGIN is unavailable: ${message}`);
  }
}
