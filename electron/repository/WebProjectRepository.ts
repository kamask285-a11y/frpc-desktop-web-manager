import Database from "better-sqlite3";
import BaseRepository, { SqlRow } from "./BaseRepository";

class WebProjectRepository extends BaseRepository<WebProject> {
  constructor(database: Database.Database) {
    super(database, "t_frpcd_web_projects", [
      "id",
      "name",
      "path",
      "start_script",
      "port",
      "auto_start",
      "domain_prefix",
      "fqdn",
      "remote_port",
      "proxy_id",
      "public_access_status",
      "last_public_access_error",
      "published_at",
      "created_at",
      "updated_at"
    ]);
  }

  async findByPath(projectPath: string): Promise<WebProject | undefined> {
    const row = this.database
      .prepare("SELECT * FROM t_frpcd_web_projects WHERE path = ?")
      .get(projectPath) as SqlRow | undefined;
    return row ? this.fromRow(row) : undefined;
  }

  protected toRow(project: WebProject): SqlRow {
    return {
      id: project._id,
      name: project.name,
      path: project.path,
      start_script: project.startScript,
      port: project.port,
      auto_start: project.autoStart ? 1 : 0,
      domain_prefix: project.domainPrefix,
      fqdn: project.fqdn,
      remote_port: project.remotePort,
      proxy_id: project.proxyId,
      public_access_status: project.publicAccessStatus,
      last_public_access_error: project.lastPublicAccessError,
      published_at: project.publishedAt,
      created_at: project.createdAt,
      updated_at: project.updatedAt
    };
  }

  protected fromRow(row: SqlRow): WebProject {
    return {
      _id: String(row.id),
      name: String(row.name),
      path: String(row.path),
      startScript: String(row.start_script),
      port: Number(row.port),
      autoStart: row.auto_start === 1,
      domainPrefix:
        row.domain_prefix === null ? null : String(row.domain_prefix),
      fqdn: row.fqdn === null ? null : String(row.fqdn),
      remotePort: row.remote_port === null ? null : Number(row.remote_port),
      proxyId: row.proxy_id === null ? null : String(row.proxy_id),
      publicAccessStatus: String(
        row.public_access_status
      ) as WebPublicAccessStatus,
      lastPublicAccessError:
        row.last_public_access_error === null
          ? null
          : String(row.last_public_access_error),
      publishedAt: row.published_at === null ? null : String(row.published_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }
}

export default WebProjectRepository;
