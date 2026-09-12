import { spawn } from "child_process";
import { createHash } from "crypto";
import { app } from "electron";
import fs from "fs";
import net from "net";
import path from "path";
import AppConfigRepository from "../repository/AppConfigRepository";
import PathUtils from "../utils/PathUtils";

interface ProcessResult {
  stdout: string;
  stderr: string;
}

const DOMAIN_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HOST_PATTERN = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)$/;
const USER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*\$?$/;
const SAFE_PATH_PATTERN = /^\/[a-zA-Z0-9_./-]+$/;
const OUTPUT_LIMIT = 64 * 1024;

class RemoteGatewayService {
  private readonly pendingHostKeys = new Map<string, string[]>();

  constructor(private readonly appConfigRepository: AppConfigRepository) {}

  getConfig(): WebGatewayConfig {
    return this.appConfigRepository.getWebGatewayConfig();
  }

  saveConfig(input: WebGatewayConfig): WebGatewayConfig {
    const config = this.normalizeConfig(input);
    this.validateConfig(config, false);
    this.appConfigRepository.saveWebGatewayConfig(config);
    return config;
  }

  async scanHostKey(): Promise<WebGatewayHostKeyScan> {
    const config = this.getConfig();
    this.validateHostAndPort(config);
    const result = await this.runProcess(
      "ssh-keyscan",
      ["-T", "10", "-p", String(config.sshPort), config.sshHost],
      undefined,
      15_000
    );
    const lines = result.stdout
      .split("\n")
      .map(line => line.trim())
      .filter(
        line => line && !line.startsWith("#") && line.split(/\s+/).length >= 3
      );
    if (lines.length === 0) {
      throw new Error("Unable to obtain the SSH host key.");
    }
    const uniqueLines = [...new Set(lines)];
    this.pendingHostKeys.set(this.hostKeyId(config), uniqueLines);
    return {
      host: config.sshHost,
      port: config.sshPort,
      keys: uniqueLines.map(line => {
        const fields = line.split(/\s+/);
        const digest = createHash("sha256")
          .update(Buffer.from(fields[2], "base64"))
          .digest("base64")
          .replace(/=+$/, "");
        return {
          algorithm: fields[1],
          fingerprint: `SHA256:${digest}`
        };
      })
    };
  }

  async trustHostKey(): Promise<WebGatewayHostKeyScan> {
    const scan = await this.scanHostKey();
    const config = this.getConfig();
    const lines = this.pendingHostKeys.get(this.hostKeyId(config)) || [];
    const knownHostsPath = this.getKnownHostsPath();
    await fs.promises.mkdir(path.dirname(knownHostsPath), { recursive: true });
    const existing = await fs.promises
      .readFile(knownHostsPath, "utf8")
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
    const merged = [...new Set([...existing.split("\n"), ...lines])]
      .filter(Boolean)
      .join("\n");
    const temporaryPath = `${knownHostsPath}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporaryPath, `${merged}\n`, { mode: 0o600 });
    await fs.promises.rename(temporaryPath, knownHostsPath);
    await fs.promises.chmod(knownHostsPath, 0o600);
    return scan;
  }

  async testConnection(): Promise<WebGatewayConnectionResult> {
    const config = this.getConfig();
    this.validateConfig(config, true);
    const sudoCheck = config.useSudo
      ? "if sudo -n true >/dev/null 2>&1; then printf '__SUDO_READY__'; else printf '__SUDO_REQUIRED__'; fi"
      : "printf '__SUDO_READY__'";
    const result = await this.runSsh(
      config,
      `printf '__SSH_CONNECTED__'; ${sudoCheck}`,
      undefined,
      20_000
    );
    const connected = result.stdout.includes("__SSH_CONNECTED__");
    const sudoReady = result.stdout.includes("__SUDO_READY__");
    return {
      connected,
      sudoReady,
      message: sudoReady
        ? "SSH connection and remote privileges are ready."
        : "SSH connected, but passwordless sudo is not available."
    };
  }

  async runAction(
    action: "deploy" | "remove" | "status",
    preview: WebPublicAccessPreview
  ): Promise<Record<string, string>> {
    const config = this.getConfig();
    this.validateConfig(config, true);
    this.validatePreview(preview, config);
    const script = await fs.promises.readFile(
      this.getRemoteScriptPath(),
      "utf8"
    );
    const values = [
      action,
      preview.fqdn,
      String(preview.remotePort),
      config.caddySitesDirectory,
      config.caddyConfigPath,
      config.publicIp
    ];
    const privilege = config.useSudo ? "sudo -n " : "";
    const remoteCommand = `${privilege}bash -s -- ${values
      .map(value => this.shellQuote(value))
      .join(" ")}`;
    const result = await this.runSsh(
      config,
      remoteCommand,
      script,
      action === "status" ? 30_000 : 60_000
    );
    return this.parseResult(result.stdout);
  }

  private normalizeConfig(input: WebGatewayConfig): WebGatewayConfig {
    return {
      sshHost: String(input?.sshHost || "").trim(),
      sshPort: Number(input?.sshPort),
      sshUser: String(input?.sshUser || "").trim(),
      identityFile: String(input?.identityFile || "").trim(),
      baseDomain: String(input?.baseDomain || "")
        .trim()
        .toLowerCase(),
      publicIp: String(input?.publicIp || "").trim(),
      remotePortMin: Number(input?.remotePortMin),
      remotePortMax: Number(input?.remotePortMax),
      caddySitesDirectory: String(input?.caddySitesDirectory || "").trim(),
      caddyConfigPath: String(input?.caddyConfigPath || "").trim(),
      useSudo: Boolean(input?.useSudo)
    };
  }

  private validateConfig(config: WebGatewayConfig, requireUser: boolean): void {
    this.validateHostAndPort(config);
    if (requireUser && !config.sshUser) {
      throw new Error("SSH user is required.");
    }
    if (config.sshUser && !USER_PATTERN.test(config.sshUser)) {
      throw new Error("Invalid SSH user.");
    }
    if (!DOMAIN_PATTERN.test(config.baseDomain)) {
      throw new Error("Invalid base domain.");
    }
    if (net.isIP(config.publicIp) !== 4) {
      throw new Error("Public IP must be a valid IPv4 address.");
    }
    if (config.remotePortMin !== 20000 || config.remotePortMax !== 29999) {
      throw new Error("Remote port range must be 20000-29999.");
    }
    if (
      !SAFE_PATH_PATTERN.test(config.caddySitesDirectory) ||
      !SAFE_PATH_PATTERN.test(config.caddyConfigPath)
    ) {
      throw new Error("Caddy paths must be safe absolute paths.");
    }
    if (config.identityFile) {
      const identityPath = this.expandHome(config.identityFile);
      const stat = fs.statSync(identityPath, { throwIfNoEntry: false });
      if (!stat?.isFile()) {
        throw new Error("SSH identity file does not exist.");
      }
    }
  }

  private validateHostAndPort(config: WebGatewayConfig): void {
    if (!HOST_PATTERN.test(config.sshHost) && net.isIP(config.sshHost) === 0) {
      throw new Error("Invalid SSH host.");
    }
    if (
      !Number.isInteger(config.sshPort) ||
      config.sshPort < 1 ||
      config.sshPort > 65535
    ) {
      throw new Error("SSH port must be between 1 and 65535.");
    }
  }

  private validatePreview(
    preview: WebPublicAccessPreview,
    config: WebGatewayConfig
  ): void {
    if (`${preview.domainPrefix}.${config.baseDomain}` !== preview.fqdn) {
      throw new Error("Public domain does not match gateway settings.");
    }
    if (
      !Number.isInteger(preview.remotePort) ||
      preview.remotePort < config.remotePortMin ||
      preview.remotePort > config.remotePortMax
    ) {
      throw new Error("Remote port is outside the configured range.");
    }
  }

  private async runSsh(
    config: WebGatewayConfig,
    remoteCommand: string,
    input?: string,
    timeout = 30_000
  ): Promise<ProcessResult> {
    const args = [
      "-p",
      String(config.sshPort),
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      `UserKnownHostsFile=${this.getKnownHostsPath()}`,
      "-o",
      "GlobalKnownHostsFile=/dev/null"
    ];
    if (config.identityFile) {
      args.push(
        "-o",
        "IdentitiesOnly=yes",
        "-i",
        this.expandHome(config.identityFile)
      );
    }
    args.push(`${config.sshUser}@${config.sshHost}`, remoteCommand);
    return this.runProcess("ssh", args, input, timeout);
  }

  private runProcess(
    command: string,
    args: string[],
    input?: string,
    timeout = 30_000
  ): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: { ...process.env, LC_ALL: "C" },
        shell: false,
        windowsHide: true
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        if (!settled) {
          settled = true;
          reject(new Error(`${command} timed out.`));
        }
      }, timeout);
      child.stdout.on("data", chunk => {
        stdout = `${stdout}${chunk}`.slice(-OUTPUT_LIMIT);
      });
      child.stderr.on("data", chunk => {
        stderr = `${stderr}${chunk}`.slice(-OUTPUT_LIMIT);
      });
      child.once("error", error => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      child.once("close", code => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        const result = this.parseOutput(stdout);
        const detail =
          result.ERROR || stderr.trim().split("\n").slice(-3).join(" ");
        reject(new Error(detail || `${command} exited with code ${code}.`));
      });
      child.stdin.end(input);
    });
  }

  private parseResult(output: string): Record<string, string> {
    const result = this.parseOutput(output);
    if (result.RESULT !== "PASS") {
      throw new Error(result.ERROR || "Remote gateway operation failed.");
    }
    return result;
  }

  private parseOutput(output: string): Record<string, string> {
    const result: Record<string, string> = {};
    output.split("\n").forEach(line => {
      const separator = line.indexOf("=");
      if (separator > 0) {
        result[line.slice(0, separator)] = line.slice(separator + 1);
      }
    });
    return result;
  }

  private getKnownHostsPath(): string {
    return path.join(PathUtils.getAppData(), "ssh", "known_hosts");
  }

  private getRemoteScriptPath(): string {
    return app.isPackaged
      ? path.join(process.resourcesPath, "scripts", "web-gateway.sh")
      : path.join(app.getAppPath(), "electron", "scripts", "web-gateway.sh");
  }

  private expandHome(filePath: string): string {
    return filePath === "~" || filePath.startsWith("~/")
      ? path.join(process.env.HOME || "", filePath.slice(2))
      : filePath;
  }

  private hostKeyId(config: WebGatewayConfig): string {
    return `${config.sshHost}:${config.sshPort}`;
  }

  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }
}

export default RemoteGatewayService;
