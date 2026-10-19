export type EntryNameResult =
  | { valid: true; name: string }
  | { valid: false; reason: string };

const MAX_ENTRY_NAME_LENGTH = 255;
// Characters Windows forbids in file names, plus the path separators.
const FORBIDDEN_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
// Windows device names are reserved with or without an extension (con.txt).
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/**
 * Validates a single file or folder name (not a path) so it is usable on
 * Windows, macOS and Linux. Never touches the filesystem.
 */
export function validateEntryName(input: string): EntryNameResult {
  const name = input.trim();

  if (name.length === 0) {
    return { valid: false, reason: "Name cannot be empty." };
  }
  if (name === "." || name === "..") {
    return { valid: false, reason: `"${name}" is not a valid name.` };
  }
  if (name.includes("/") || name.includes("\\")) {
    return { valid: false, reason: "Name cannot contain / or \\. Create folders one level at a time." };
  }
  if (FORBIDDEN_CHARS.test(name)) {
    return { valid: false, reason: 'Name cannot contain any of < > : " | ? * or control characters.' };
  }
  if (name.endsWith(".")) {
    return { valid: false, reason: "Name cannot end with a dot." };
  }
  if (name.length > MAX_ENTRY_NAME_LENGTH) {
    return { valid: false, reason: `Name must be ${MAX_ENTRY_NAME_LENGTH} characters or fewer.` };
  }
  if (RESERVED_DEVICE.test(name)) {
    return { valid: false, reason: `"${name}" is reserved by Windows.` };
  }

  return { valid: true, name };
}
