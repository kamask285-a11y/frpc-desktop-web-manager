import { createHash } from "crypto";
import Logger from "../core/Logger";
import ProxyRepository from "../repository/ProxyRepository";
import WebProjectRepository from "../repository/WebProjectRepository";
import NetUtils from "../utils/NetUtils";
import FrpcProcessService from "./FrpcProcessService";
import ProxyService from "./ProxyService";
import RemoteGatewayService from "./RemoteGatewayService";
import WebProjectService from "./WebProjectService";

const DOMAIN_PREFIX_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

class WebPublicationService {
  constructor(
    private readonly projectRepository: WebProjectRepository,
    private readonly proxyRepository: ProxyRepository,
    private readonly projectService: WebProjectService,
    private readonly proxyService: ProxyService,
    private readonly frpcProcessService: FrpcProcessService,
    private readonly gatewayService: RemoteGatewayService
  ) {}

  async preview(
    projectId: string,
    domainPrefix: string
  ): Promise<WebPublicAccessPreview> {
    const project = await this.requireProject(projectId);
    const prefix = this.normalizeDomainPrefix(domainPrefix);
    const gateway = this.gatewayService.getConfig();
    if (!gateway.baseDomain || !gateway.publicIp) {
      throw new Error(
        "Configure the gateway server address, base domain and public IP in Server Settings first."
      );
    }
    const fqdn = `${prefix}.${gateway.baseDomain}`;
    const digest = createHash("sha256").update(fqdn).digest();
    const value = digest.readUInt32BE(0);
    const range = gateway.remotePortMax - gateway.remotePortMin + 1;
    const remotePort = gateway.remotePortMin + (value % range);
    return {
      projectId: project._id,
      domainPrefix: prefix,
      fqdn,
      localPort: project.port,
      remotePort,
      dnsType: "A",
      dnsName: fqdn,
      dnsValue: gateway.publicIp
    };
  }

  async publish(
    projectId: string,
    domainPrefix: string
  ): Promise<WebPublicAccessCheck> {
    let project = await this.requireProject(projectId);
    const preview = await this.preview(projectId, domainPrefix);
    if (
      project.publicAccessStatus !== "disabled" &&
      project.domainPrefix &&
      project.domainPrefix !== preview.domainPrefix
    ) {
      throw new Error(
        "Disable the existing public access before changing the domain prefix."
      );
    }
    await this.assertNoConflicts(preview, project);
    project = await this.saveProject(project, {
      domainPrefix: preview.domainPrefix,
      fqdn: preview.fqdn,
      remotePort: preview.remotePort,
      publicAccessStatus: "deploying",
      lastPublicAccessError: null
    });

    let proxyCreated = false;
    let remoteDeployed = false;
    try {
      const runningProject = await this.projectService.startProject(projectId);
      await this.waitForLocalPort(runningProject.port);
      const proxy = await this.ensureProxy(project, preview);
      proxyCreated = proxy.created;
      project = await this.saveProject(project, { proxyId: proxy.value._id });
      await this.frpcProcessService.startFrpcProcess();
      await this.waitForRemoteBackend(preview);
      await this.gatewayService.runAction("deploy", preview);
      remoteDeployed = true;
      project = await this.saveProject(project, {
        publicAccessStatus: "waiting_dns",
        publishedAt: new Date().toISOString(),
        lastPublicAccessError: null
      });
      Logger.info(
        "WebPublicationService.publish",
        `Published web project id=${projectId}, remotePort=${preview.remotePort}`
      );
      return this.check(projectId);
    } catch (error) {
      const message = (error as Error).message;
      if (proxyCreated && !remoteDeployed && project.proxyId) {
        await this.proxyService.deleteProxy(project.proxyId).catch(() => {});
        project = await this.saveProject(project, { proxyId: null });
      }
      await this.saveProject(project, {
        publicAccessStatus: "error",
        lastPublicAccessError: message
      });
      throw error;
    }
  }

  async check(projectId: string): Promise<WebPublicAccessCheck> {
    let project = await this.requireProject(projectId);
    const preview = this.previewFromProject(project);
    try {
      const result = await this.gatewayService.runAction("status", preview);
      const backendReady = this.isHttpResponse(result.BACKEND_STATUS);
      const dnsReady = result.DNS_READY === "yes";
      const caddyConfigReady = result.CONFIG_READY === "yes";
      const caddyActive = result.CADDY_STATUS === "active";
      const httpsReady = this.isHttpResponse(result.HTTPS_STATUS);
      const status: WebPublicAccessStatus =
        backendReady &&
        dnsReady &&
        caddyConfigReady &&
        caddyActive &&
        httpsReady
          ? "online"
          : "waiting_dns";
      const error =
        !backendReady || !caddyConfigReady || !caddyActive
          ? "Public access is not fully ready. Check FRP and Caddy status."
          : null;
      project = await this.saveProject(project, {
        publicAccessStatus: error ? "error" : status,
        lastPublicAccessError: error
      });
      return {
        project: await this.projectServiceView(project),
        status: project.publicAccessStatus,
        dnsReady,
        backendReady,
        caddyConfigReady,
        caddyActive,
        httpsReady,
        httpsStatus: this.parseHttpStatus(result.HTTPS_STATUS),
        error
      };
    } catch (error) {
      const message = (error as Error).message;
      project = await this.saveProject(project, {
        publicAccessStatus: "error",
        lastPublicAccessError: message
      });
      throw error;
    }
  }

  async unpublish(projectId: string): Promise<WebProjectView> {
    let project = await this.requireProject(projectId);
    if (!project.fqdn || !project.domainPrefix || !project.remotePort) {
      return this.projectServiceView(
        await this.saveProject(project, {
          publicAccessStatus: "disabled",
          lastPublicAccessError: null
        })
      );
    }
    const preview = this.previewFromProject(project);
    try {
      await this.gatewayService.runAction("remove", preview);
      if (project.proxyId) {
        const proxy = await this.proxyRepository.findById(project.proxyId);
        if (proxy) {
          await this.proxyService.deleteProxy(project.proxyId);
        }
      }
      project = await this.saveProject(project, {
        domainPrefix: null,
        fqdn: null,
        remotePort: null,
        proxyId: null,
        publicAccessStatus: "disabled",
        lastPublicAccessError: null,
        publishedAt: null
      });
      Logger.info(
        "WebPublicationService.unpublish",
        `Removed public access for web project id=${projectId}`
      );
      return this.projectServiceView(project);
    } catch (error) {
      await this.saveProject(project, {
        publicAccessStatus: "cleanup_pending",
        lastPublicAccessError: (error as Error).message
      });
      throw error;
    }
  }

  async removeProject(projectId: string): Promise<void> {
    const project = await this.requireProject(projectId);
    if (project.fqdn || project.publicAccessStatus !== "disabled") {
      await this.unpublish(projectId);
    }
    await this.projectService.stopProject(projectId);
    await this.projectRepository.deleteById(projectId);
    Logger.info(
      "WebPublicationService.removeProject",
      `Removed web project record id=${projectId}`
    );
  }

  private async ensureProxy(
    project: WebProject,
    preview: WebPublicAccessPreview
  ): Promise<{ value: FrpcProxy; created: boolean }> {
    const existing = project.proxyId
      ? await this.proxyRepository.findById(project.proxyId)
      : undefined;
    const desired = this.createProxy(project, preview, existing?._id || "");
    if (existing) {
      return {
        value: await this.proxyService.updateProxy(desired),
        created: false
      };
    }
    return {
      value: await this.proxyService.insertProxy(desired),
      created: true
    };
  }

  private createProxy(
    project: WebProject,
    preview: WebPublicAccessPreview,
    id: string
  ): FrpcProxy {
    return {
      _id: id,
      name: `web-${preview.domainPrefix}`,
      type: "tcp",
      localIP: "127.0.0.1",
      localPort: String(project.port),
      remotePort: String(preview.remotePort),
      customDomains: [""],
      locations: [""],
      hostHeaderRewrite: "",
      visitorsModel: "visitors",
      serverUser: "",
      serverName: "",
      secretKey: "",
      bindAddr: "",
      bindPort: null,
      subdomain: "",
      basicAuth: false,
      httpUser: "",
      httpPassword: "",
      fallbackTo: "",
      fallbackTimeoutMs: 500,
      https2http: false,
      https2httpCaFile: "",
      https2httpKeyFile: "",
      keepTunnelOpen: false,
      status: 1,
      transport: {
        useEncryption: false,
        useCompression: false,
        proxyProtocolVersion: ""
      }
    };
  }

  private async assertNoConflicts(
    preview: WebPublicAccessPreview,
    current: WebProject
  ): Promise<void> {
    const projects = await this.projectRepository.findAll();
    if (
      projects.some(
        project =>
          project._id !== current._id &&
          (project.fqdn === preview.fqdn ||
            project.remotePort === preview.remotePort)
      )
    ) {
      throw new Error(
        "The domain or calculated remote port is already in use."
      );
    }
    const proxies = await this.proxyRepository.findAll();
    if (
      proxies.some(
        proxy =>
          proxy._id !== current.proxyId &&
          proxy.type === "tcp" &&
          Number(proxy.remotePort) === preview.remotePort
      )
    ) {
      throw new Error(
        `FRP remote port ${preview.remotePort} is already in use.`
      );
    }
  }

  private async waitForLocalPort(port: number): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await NetUtils.checkPortInUse(port, "127.0.0.1")) return;
      await this.delay(500);
    }
    throw new Error(`Local service did not listen on port ${port}.`);
  }

  private async waitForRemoteBackend(
    preview: WebPublicAccessPreview
  ): Promise<void> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const result = await this.gatewayService.runAction("status", preview);
        if (this.isHttpResponse(result.BACKEND_STATUS)) return;
      } catch (error) {
        lastError = error as Error;
      }
      await this.delay(2_000);
    }
    throw (
      lastError || new Error("FRP backend is not reachable from the server.")
    );
  }

  private previewFromProject(project: WebProject): WebPublicAccessPreview {
    if (!project.domainPrefix || !project.fqdn || !project.remotePort) {
      throw new Error("Public access is not configured for this project.");
    }
    const gateway = this.gatewayService.getConfig();
    return {
      projectId: project._id,
      domainPrefix: project.domainPrefix,
      fqdn: project.fqdn,
      localPort: project.port,
      remotePort: project.remotePort,
      dnsType: "A",
      dnsName: project.fqdn,
      dnsValue: gateway.publicIp
    };
  }

  private normalizeDomainPrefix(value: string): string {
    const result = String(value || "").trim();
    if (!DOMAIN_PREFIX_PATTERN.test(result)) {
      throw new Error(
        "Domain prefix must contain only lowercase letters, numbers, and hyphens, and must start and end with a letter or number."
      );
    }
    return result;
  }

  private async requireProject(id: string): Promise<WebProject> {
    if (typeof id !== "string" || !id) {
      throw new Error("Project id is required.");
    }
    const project = await this.projectRepository.findById(id);
    if (!project) {
      throw new Error("Web project was not found.");
    }
    return project;
  }

  private async saveProject(
    project: WebProject,
    changes: Partial<WebProject>
  ): Promise<WebProject> {
    const updated = {
      ...project,
      ...changes,
      updatedAt: new Date().toISOString()
    };
    return this.projectRepository.updateById(project._id, updated);
  }

  private async projectServiceView(
    project: WebProject
  ): Promise<WebProjectView> {
    const projects = await this.projectService.getProjects(false);
    const result = projects.find(item => item._id === project._id);
    if (!result) throw new Error("Web project was not found.");
    return result;
  }

  private isHttpResponse(value?: string): boolean {
    return this.parseHttpStatus(value) !== null;
  }

  private parseHttpStatus(value?: string): number | null {
    const status = Number(value);
    return Number.isInteger(status) && status >= 100 && status <= 599
      ? status
      : null;
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }
}

export default WebPublicationService;
