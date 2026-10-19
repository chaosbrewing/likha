export { WorkspaceService, fileVersion, fsFailure, type WorkspaceServiceOptions } from "./workspace-service.js";
export { inspectProject, readGitBranch, readSafeScriptNames } from "./project.js";
export { scaffoldProject, type ScaffoldResult } from "./scaffold.js";
export { baseName, isInside, joinRelative, parentOf, parseRelativePath, toRelative } from "./paths.js";
export { isIgnoredChange, watchWorkspace, type WatchOptions, type WorkspaceWatcher } from "./watcher.js";
