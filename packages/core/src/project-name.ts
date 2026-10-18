export type ProjectNameResult =
  | { valid: true; name: string }
  | { valid: false; reason: string };

const MAX_NAME_LENGTH = 214;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;

// Device names Windows refuses to use as file or folder names.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/**
 * Checks that a project name is safe to use as a single folder name and as
 * an npm package name. It never touches the filesystem.
 */
export function validateProjectName(input: string): ProjectNameResult {
  const name = input.trim();

  if (name.length === 0) {
    return { valid: false, reason: "Project name cannot be empty." };
  }

  if (
    name.includes("/") ||
    name.includes("\\") ||
    name.includes(":") ||
    name === "." ||
    name.includes("..")
  ) {
    return {
      valid: false,
      reason:
        "Project name must be a single folder name, not a path. " +
        "Run the command from the folder where the project should be created."
    };
  }

  if (name.length > MAX_NAME_LENGTH) {
    return {
      valid: false,
      reason: `Project name must be ${MAX_NAME_LENGTH} characters or fewer.`
    };
  }

  if (!NAME_PATTERN.test(name)) {
    return {
      valid: false,
      reason:
        "Project name must use lowercase letters, " +
        "numbers, hyphens or underscores, and start with a letter or number."
    };
  }

  if (WINDOWS_RESERVED.test(name)) {
    return {
      valid: false,
      reason: `Project name "${name}" is reserved by Windows. Choose another name.`
    };
  }

  return { valid: true, name };
}
