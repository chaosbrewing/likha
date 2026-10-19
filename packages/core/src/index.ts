import { validateProjectName } from "./project-name.js";

export * from "./studio.js";
export * from "./project-name.js";
export * from "./entry-name.js";
export * from "./project-config.js";
export * from "./project-template.js";

export interface StudioProject {
  name: string;
  version: string;
  language: "typescript";
  createdAt: string;
}

export function createProject(
  name: string
): StudioProject {
  const result = validateProjectName(name);

  if (!result.valid) {
    throw new Error(result.reason);
  }

  return {
    name: result.name,
    version: "0.1.0",
    language: "typescript",
    createdAt: new Date().toISOString()
  };
}
