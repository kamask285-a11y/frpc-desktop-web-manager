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
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }
}

export default WebProjectRepository;
