export interface StudioInfo {
  name: string;
  version: string;
  status: "ready";
}

export const PRODUCT_NAME = "Origin Studio";

export function getStudioInfo(): StudioInfo {
  return {
    name: PRODUCT_NAME,
    version: "0.1.0",
    status: "ready"
  };
}

export function getWelcomeMessage(): string {
  return `Welcome to ${PRODUCT_NAME}!`;
}
