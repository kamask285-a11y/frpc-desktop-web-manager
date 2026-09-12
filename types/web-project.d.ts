type WebProjectRuntimeStatus = "running" | "stopped" | "error" | "missing";

type WebPublicAccessStatus =
  | "disabled"
  | "deploying"
  | "waiting_dns"
  | "online"
  | "error"
  | "cleanup_pending";

interface WebGatewayConfig {
  sshHost: string;
  sshPort: number;
  sshUser: string;
  identityFile: string;
  baseDomain: string;
  publicIp: string;
  remotePortMin: number;
  remotePortMax: number;
  caddySitesDirectory: string;
  caddyConfigPath: string;
  useSudo: boolean;
}

interface WebGatewayConnectionResult {
  connected: boolean;
  sudoReady: boolean;
  message: string;
}

interface WebGatewayHostKey {
  algorithm: string;
  fingerprint: string;
}

interface WebGatewayHostKeyScan {
  host: string;
  port: number;
  keys: WebGatewayHostKey[];
}

interface WebPublicAccessPreview {
  domainPrefix: string;
  fqdn: string;
  localPort: number;
  remotePort: number;
  dnsType: "A";
  dnsName: string;
  dnsValue: string;
}

interface WebPublicAccessCheck {
  status: WebPublicAccessStatus;
  dnsReady: boolean;
  backendReady: boolean;
  caddyConfigReady: boolean;
  caddyActive: boolean;
  httpsReady: boolean;
  httpsStatus: number | null;
  error: string | null;
}

interface WebProject extends BaseEntity {
  name: string;
  path: string;
  startScript: string;
  port: number;
  autoStart: boolean;
  domainPrefix: string | null;
  fqdn: string | null;
  remotePort: number | null;
  proxyId: string | null;
  publicAccessStatus: WebPublicAccessStatus;
  lastPublicAccessError: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface WebProjectView extends WebProject {
  status: WebProjectRuntimeStatus;
  pid: number | null;
  startedAt: number | null;
  lastExitCode: number | null;
  lastError: string | null;
  availableScripts: string[];
}

interface WebProjectUpdate {
  _id: string;
  name: string;
  startScript: string;
  port: number;
  autoStart: boolean;
}

interface WebProjectLog {
  projectId: string;
  content: string;
}
