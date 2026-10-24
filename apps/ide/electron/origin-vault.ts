import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { fail, ok, type CredentialVault, type Result } from "@studio/contracts";

/** The part of Electron's safeStorage the vault uses (injectable for tests). */
export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

const MAGIC = "OSV1";

/**
 * Keeps the ORIGIN credential encrypted at rest with the OS user's key
 * (Electron safeStorage: DPAPI on Windows). The file lives in the settings
 * folder, never in a project. Without OS encryption nothing is stored and the
 * credential lives for the session only.
 */
export function createSafeStorageVault(options: { file: string; cipher: SecretCipher; log(message: string): void }): CredentialVault {
  const { file, cipher, log } = options;
  return {
    get description() {
      return cipher.isEncryptionAvailable() ? "encrypted with the Windows user's key (safeStorage)" : "not stored: OS encryption is unavailable";
    },
    async load(): Promise<string | null> {
      let bytes: Buffer;
      try {
        bytes = await readFile(file);
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return null;
        throw error;
      }
      if (bytes.subarray(0, 4).toString("ascii") !== MAGIC) {
        log("The stored ORIGIN credential has an unknown format; ignoring it.");
        return null;
      }
      if (!cipher.isEncryptionAvailable()) {
        log("A stored ORIGIN credential exists but OS encryption is unavailable; it cannot be read.");
        return null;
      }
      try {
        return cipher.decryptString(bytes.subarray(4));
      } catch (error) {
        log(`The stored ORIGIN credential could not be decrypted: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    },
    async save(secret: string): Promise<Result<void>> {
      if (!cipher.isEncryptionAvailable()) {
        return fail("UNAVAILABLE", "OS encryption is unavailable, so the credential is kept for this session only.");
      }
      try {
        const encrypted = Buffer.concat([Buffer.from(MAGIC, "ascii"), cipher.encryptString(secret)]);
        const temp = `${file}.tmp`;
        await writeFile(temp, encrypted, { mode: 0o600 });
        await rename(temp, file);
        return ok(undefined);
      } catch (error) {
        return fail("UNKNOWN", `Could not store the credential: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    async clear(): Promise<void> {
      try {
        await unlink(file);
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
      }
    }
  };
}
