import {
  fail,
  type AgosAdapter,
  type BinhiAdapter,
  type IntegrationStatus,
  type LiyabAdapter,
  type OriginAdapters,
  type OriginCoreAdapter,
  type Result,
  type TalaAdapter
} from "@studio/contracts";

const DETAIL = "Not connected. Origin Studio is running in local mode; ORIGIN integration is a future milestone.";

function status(system: IntegrationStatus["system"]): IntegrationStatus {
  return { system, connected: false, detail: DETAIL };
}

async function notConnected<T>(): Promise<Result<T>> {
  return fail("NOT_CONNECTED", DETAIL);
}

/**
 * The adapters Origin Studio uses today: every ORIGIN system reports itself as
 * offline and every call fails with NOT_CONNECTED. Local editing never
 * depends on them.
 */
export function createOfflineAdapters(): OriginAdapters {
  const core: OriginCoreAdapter = {
    status: () => status("origin-core"),
    findLinkedProject: notConnected,
    syncState: notConnected
  };
  const binhi: BinhiAdapter = {
    status: () => status("binhi"),
    importSite: notConnected,
    exportSite: notConnected
  };
  const tala: TalaAdapter = {
    status: () => status("tala"),
    propose: notConnected,
    decide: notConnected,
    markApplied: notConnected,
    auditLog: notConnected
  };
  const agos: AgosAdapter = {
    status: () => status("agos"),
    publish: notConnected,
    tasks: notConnected
  };
  const liyab: LiyabAdapter = {
    status: () => status("liyab"),
    capabilities: notConnected,
    startPreview: notConnected,
    logs: notConnected,
    handOffDeployment: notConnected
  };
  return { core, binhi, tala, agos, liyab };
}
