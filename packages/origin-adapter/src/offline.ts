import {
  AGOS_CONTRACT_VERSION,
  BINHI_CONTRACT_VERSION,
  LIYAB_CONTRACT_VERSION,
  ORIGIN_CORE_CONTRACT_VERSION,
  POCKET_CONTRACT_VERSION,
  TALA_CONTRACT_VERSION,
  fail,
  type IntegrationStatus,
  type OriginAdapters,
  type OriginCoreAdapter,
  type Result
} from "@studio/contracts";

const DETAIL = "Not connected. Origin Studio is running in local mode; the origin-core feature is off.";

function status(system: IntegrationStatus["system"], contractVersion: number): IntegrationStatus {
  return { system, connected: false, transport: "none", contractVersion, detail: DETAIL };
}

async function notConnected<T>(): Promise<Result<T>> {
  return fail("NOT_CONNECTED", DETAIL);
}

/**
 * The adapters Origin Studio uses when the origin-core feature is off: every
 * ORIGIN system reports itself as offline and every call fails with
 * NOT_CONNECTED. Local editing never depends on them.
 */
export function createOfflineAdapters(): OriginAdapters {
  const core: OriginCoreAdapter = {
    status: () => status("origin-core", ORIGIN_CORE_CONTRACT_VERSION),
    findLink: notConnected,
    resolveProject: notConnected,
    syncState: notConnected
  };
  const binhi: OriginAdapters["binhi"] = {
    contractVersion: BINHI_CONTRACT_VERSION,
    status: () => status("binhi", BINHI_CONTRACT_VERSION),
    listSites: notConnected,
    getSite: notConnected,
    requestEditorHandoff: notConnected
  };
  const tala: OriginAdapters["tala"] = {
    contractVersion: TALA_CONTRACT_VERSION,
    status: () => status("tala", TALA_CONTRACT_VERSION),
    propose: notConnected,
    decide: notConnected,
    markApplied: notConnected,
    auditLog: notConnected,
    capabilities: notConnected,
    requestApproval: notConnected,
    getApproval: notConnected,
    cancelApproval: notConnected,
    listApprovals: notConnected
  };
  const agos: OriginAdapters["agos"] = {
    contractVersion: AGOS_CONTRACT_VERSION,
    status: () => status("agos", AGOS_CONTRACT_VERSION),
    listWorkflows: notConnected,
    listRuns: notConnected,
    getRun: notConnected,
    publish: notConnected
  };
  const liyab: OriginAdapters["liyab"] = {
    contractVersion: LIYAB_CONTRACT_VERSION,
    status: () => status("liyab", LIYAB_CONTRACT_VERSION),
    snapshot: notConnected,
    logs: notConnected,
    handOffDeployment: notConnected
  };
  const pocket: OriginAdapters["pocket"] = {
    contractVersion: POCKET_CONTRACT_VERSION,
    status: () => status("pocket", POCKET_CONTRACT_VERSION),
    projectSummary: notConnected,
    activity: notConnected,
    notifications: notConnected,
    subscribe: () => () => undefined
  };
  return { core, binhi, tala, agos, liyab, pocket };
}
