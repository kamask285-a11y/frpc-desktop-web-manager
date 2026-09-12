type WebProjectRuntimeStatus = "running" | "stopped" | "error" | "missing";

interface WebProject extends BaseEntity {
  name: string;
  path: string;
  startScript: string;
  port: number;
  autoStart: boolean;
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
