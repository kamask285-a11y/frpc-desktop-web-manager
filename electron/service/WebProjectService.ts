import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { shell } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import treeKill from "tree-kill";
import Logger from "../core/Logger";
import WebProjectRepository from "../repository/WebProjectRepository";
import NetUtils from "../utils/NetUtils";

interface ProjectRuntime {
  process: ChildProcessWithoutNullStreams | null;
  status: WebProjectRuntimeStatus;
  startedAt: number | null;
  lastExitCode: number | null;
  lastError: string | null;
  log: string;
}

interface PackageMetadata {
  name?: string;
  scripts?: Record<string, string>;
}

const LOG_LIMIT = 64 * 1024;
const SCRIPT_NAME_PATTERN = /^[a-zA-Z0-9:_-]+$/;

class WebProjectService {
  private readonly runtimes = new Map<string, ProjectRuntime>();

  constructor(
    private readonly repository: WebProjectRepository,
    private readonly webRoot = process.platform === "darwin"
      ? "/Volumes/Box-1T/Web"
      : path.join(os.homedir(), "Web")
  ) {}

  async getProjects(scan = true): Promise<WebProjectView[]> {
    if (scan) {
      await this.scanProjects();
    }
    const projects = await this.repository.findAll();
    return Promise.all(projects.map(project => this.toView(project)));
  }

  async scanProjects(): Promise<WebProjectView[]> {
    await fs.promises.mkdir(this.webRoot, { recursive: true });
    const entries = await fs.promises.readdir(this.webRoot, {
      withFileTypes: true
    });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      const projectPath = path.join(this.webRoot, entry.name);
      const packageMetadata = await this.readPackageMetadata(projectPath);
      if (!packageMetadata || (await this.repository.findByPath(projectPath))) {
        continue;
      }
      const now = new Date().toISOString();
      await this.repository.insert({
        _id: "",
        name: packageMetadata.name || entry.name,
        path: projectPath,
        startScript: this.pickStartScript(packageMetadata.scripts),
        port: await this.pickAvailablePort(3000),
        autoStart: false,
        domainPrefix: null,
        fqdn: null,
        remotePort: null,
        proxyId: null,
        publicAccessStatus: "disabled",
        lastPublicAccessError: null,
        publishedAt: null,
        createdAt: now,
        updatedAt: now
      });
    }

    return this.getProjects(false);
  }

  async updateProject(input: WebProjectUpdate): Promise<WebProjectView> {
    const project = await this.requireProject(input._id);
    const metadata = await this.requirePackageMetadata(project.path);
    const name = input.name?.trim();
    if (!name) {
      throw new Error("Project name is required.");
    }
    if (!SCRIPT_NAME_PATTERN.test(input.startScript)) {
      throw new Error("Invalid npm script name.");
    }
    if (!metadata.scripts?.[input.startScript]) {
      throw new Error(`npm script '${input.startScript}' does not exist.`);
    }
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
      throw new Error("Port must be an integer between 1 and 65535.");
    }
    const updated = await this.repository.updateById(project._id, {
      ...project,
      name,
      startScript: input.startScript,
      port: input.port,
      autoStart: Boolean(input.autoStart),
      updatedAt: new Date().toISOString()
    });
    return this.toView(updated);
  }

  async startProject(id: string): Promise<WebProjectView> {
    const project = await this.requireProject(id);
    const current = this.runtimes.get(id);
    if (current?.process && this.isProcessAlive(current.process.pid)) {
      return this.toView(project);
    }
    const metadata = await this.requirePackageMetadata(project.path);
    if (!metadata.scripts?.[project.startScript]) {
      throw new Error(`npm script '${project.startScript}' does not exist.`);
    }
    if (await NetUtils.checkPortInUse(project.port, "127.0.0.1")) {
      throw new Error(`Port ${project.port} is already in use.`);
    }

    const runtime: ProjectRuntime = {
      process: null,
      status: "stopped",
      startedAt: null,
      lastExitCode: null,
      lastError: null,
      log: ""
    };
    this.runtimes.set(id, runtime);
    const child = spawn(
      process.platform === "win32" ? "cmd.exe" : "/bin/zsh",
      process.platform === "win32"
        ? ["/d", "/s", "/c", `npm run ${project.startScript}`]
        : ["-lc", `exec npm run ${project.startScript}`],
      {
        cwd: project.path,
        env: { ...process.env, PORT: String(project.port) },
        shell: false,
        windowsHide: true
      }
    );
    runtime.process = child;

    child.stdout.on("data", chunk => this.appendLog(runtime, chunk.toString()));
    child.stderr.on("data", chunk => this.appendLog(runtime, chunk.toString()));
    child.on("exit", code => {
      runtime.process = null;
      runtime.status = code === 0 ? "stopped" : "error";
      runtime.startedAt = null;
      runtime.lastExitCode = code;
      if (code !== 0 && !runtime.lastError) {
        runtime.lastError = `Process exited with code ${code ?? "unknown"}.`;
      }
    });

    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => {
        runtime.status = "running";
        runtime.startedAt = Date.now();
        this.appendLog(
          runtime,
          `[Frpc-Desktop] Started npm run ${project.startScript} on port ${project.port}.\n`
        );
        resolve();
      });
      child.once("error", error => {
        runtime.status = "error";
        runtime.lastError = error.message;
        this.appendLog(runtime, `[Frpc-Desktop] ${error.message}\n`);
        reject(error);
      });
    });
    Logger.info(
      "WebProjectService.startProject",
      `Started web project id=${id}, pid=${child.pid}, port=${project.port}`
    );
    return this.toView(project);
  }

  async stopProject(id: string): Promise<WebProjectView> {
    const project = await this.requireProject(id);
    const runtime = this.runtimes.get(id);
    const pid = runtime?.process?.pid;
    if (runtime && pid && this.isProcessAlive(pid)) {
      await new Promise<void>((resolve, reject) => {
        treeKill(pid, "SIGTERM", error => {
          if (!error || !this.isProcessAlive(pid)) {
            resolve();
            return;
          }
          reject(error);
        });
      });
      runtime.process = null;
      runtime.status = "stopped";
      runtime.startedAt = null;
      this.appendLog(runtime, "[Frpc-Desktop] Service stopped.\n");
      Logger.info(
        "WebProjectService.stopProject",
        `Stopped web project id=${id}, pid=${pid}`
      );
    }
    return this.toView(project);
  }

  async restartProject(id: string): Promise<WebProjectView> {
    await this.stopProject(id);
    return this.startProject(id);
  }

  async getProjectLog(id: string): Promise<WebProjectLog> {
    await this.requireProject(id);
    return { projectId: id, content: this.runtimes.get(id)?.log || "" };
  }

  async openProjectDirectory(id: string): Promise<void> {
    const project = await this.requireProject(id);
    const error = await shell.openPath(project.path);
    if (error) {
      throw new Error(error);
    }
  }

  async startAutoStartProjects(): Promise<void> {
    const projects = await this.getProjects();
    for (const project of projects.filter(item => item.autoStart)) {
      try {
        await this.startProject(project._id);
      } catch (error) {
        Logger.warn(
          "WebProjectService.startAutoStartProjects",
          `Unable to auto-start project id=${project._id}: ${(error as Error).message}`
        );
      }
    }
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.runtimes.keys()].map(id =>
        this.stopProject(id).catch(error => {
          Logger.warn(
            "WebProjectService.dispose",
            `Unable to stop project id=${id}: ${(error as Error).message}`
          );
        })
      )
    );
  }

  private async toView(project: WebProject): Promise<WebProjectView> {
    const metadata = await this.readPackageMetadata(project.path);
    const runtime = this.runtimes.get(project._id);
    const pid = runtime?.process?.pid ?? null;
    const running = Boolean(pid && this.isProcessAlive(pid));
    return {
      ...project,
      status: metadata
        ? running
          ? "running"
          : runtime?.status || "stopped"
        : "missing",
      pid: running ? pid : null,
      startedAt: running ? runtime?.startedAt || null : null,
      lastExitCode: runtime?.lastExitCode ?? null,
      lastError: runtime?.lastError ?? null,
      availableScripts: Object.keys(metadata?.scripts || {})
    };
  }

  private async requireProject(id: string): Promise<WebProject> {
    if (typeof id !== "string" || !id) {
      throw new Error("Project id is required.");
    }
    const project = await this.repository.findById(id);
    if (!project) {
      throw new Error("Web project was not found.");
    }
    this.assertProjectPath(project.path);
    return project;
  }

  private async requirePackageMetadata(
    projectPath: string
  ): Promise<PackageMetadata> {
    const metadata = await this.readPackageMetadata(projectPath);
    if (!metadata) {
      throw new Error("package.json was not found or is invalid.");
    }
    return metadata;
  }

  private async readPackageMetadata(
    projectPath: string
  ): Promise<PackageMetadata | null> {
    try {
      this.assertProjectPath(projectPath);
      const content = await fs.promises.readFile(
        path.join(projectPath, "package.json"),
        "utf8"
      );
      const parsed = JSON.parse(content) as PackageMetadata;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        Logger.warn(
          "WebProjectService.readPackageMetadata",
          `Unable to read project metadata: ${error.message}`
        );
      }
      return null;
    }
  }

  private assertProjectPath(projectPath: string): void {
    const resolvedRoot = path.resolve(this.webRoot);
    const resolvedProject = path.resolve(projectPath);
    if (
      resolvedProject === resolvedRoot ||
      !resolvedProject.startsWith(`${resolvedRoot}${path.sep}`)
    ) {
      throw new Error("Project path is outside the configured Web root.");
    }
  }

  private pickStartScript(scripts?: Record<string, string>): string {
    if (scripts?.start) return "start";
    if (scripts?.dev) return "dev";
    if (scripts?.serve) return "serve";
    return Object.keys(scripts || {})[0] || "start";
  }

  private async pickAvailablePort(start: number): Promise<number> {
    const configured = await this.repository.findAll();
    for (let port = start; port <= 65535; port += 1) {
      if (
        !configured.some(project => project.port === port) &&
        !(await NetUtils.checkPortInUse(port, "127.0.0.1"))
      ) {
        return port;
      }
    }
    throw new Error("No available web service port was found.");
  }

  private appendLog(runtime: ProjectRuntime, content: string): void {
    runtime.log = `${runtime.log}${content}`.slice(-LOG_LIMIT);
  }

  private isProcessAlive(pid?: number): boolean {
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: any) {
      return error.code === "EPERM";
    }
  }
}

export default WebProjectService;
