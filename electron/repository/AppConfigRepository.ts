import Database from "better-sqlite3";
import IdUtils from "../utils/IdUtils";

interface AppConfigRow {
  config_key: string;
  config_value: string;
}

class AppConfigRepository {
  private static readonly DESKTOP_DEFAULTS: FrpcSystemConfiguration = {
    launchAtStartup: false,
    silentStartup: false,
    autoConnectOnStartup: false,
    language: "en-US"
  };

  // Gateway settings are machine specific, so they start empty and are filled
  // in through "Server Settings" before public access can be used.
  private static readonly WEB_GATEWAY_DEFAULTS: WebGatewayConfig = {
    sshHost: "",
    sshPort: 22,
    sshUser: "",
    identityFile: "",
    baseDomain: "",
    publicIp: "",
    remotePortMin: 20000,
    remotePortMax: 29999,
    caddySitesDirectory: "/etc/caddy/acli.d/sites",
    caddyConfigPath: "/etc/caddy/Caddyfile",
    useSudo: true
  };

  constructor(private readonly database: Database.Database) {}

  public getSystemConfig(): FrpcSystemConfiguration {
    const rows = this.database
      .prepare(
        `SELECT config_key, config_value
         FROM t_frpcd_app_config
         WHERE scope_type = 'global'
           AND scope_id IS NULL
           AND namespace = 'desktop'
           AND deleted_at IS NULL`
      )
      .all() as AppConfigRow[];
    const values = new Map(rows.map(row => [row.config_key, row.config_value]));
    return {
      launchAtStartup: this.readBoolean(
        values.get("launch_at_startup"),
        AppConfigRepository.DESKTOP_DEFAULTS.launchAtStartup
      ),
      silentStartup: this.readBoolean(
        values.get("silent_startup"),
        AppConfigRepository.DESKTOP_DEFAULTS.silentStartup
      ),
      autoConnectOnStartup: this.readBoolean(
        values.get("auto_connect_on_startup"),
        AppConfigRepository.DESKTOP_DEFAULTS.autoConnectOnStartup
      ),
      language:
        values.get("language") || AppConfigRepository.DESKTOP_DEFAULTS.language
    };
  }

  public saveSystemConfig(system?: FrpcSystemConfiguration): void {
    const config = system || AppConfigRepository.DESKTOP_DEFAULTS;
    this.upsert(
      "desktop",
      "launch_at_startup",
      "boolean",
      String(config.launchAtStartup ?? false)
    );
    this.upsert(
      "desktop",
      "silent_startup",
      "boolean",
      String(config.silentStartup ?? false)
    );
    this.upsert(
      "desktop",
      "auto_connect_on_startup",
      "boolean",
      String(config.autoConnectOnStartup ?? false)
    );
    this.upsert("desktop", "language", "string", config.language || "en-US");
  }

  public getWebGatewayConfig(): WebGatewayConfig {
    const values = this.getNamespace("web_gateway");
    return {
      sshHost:
        values.get("ssh_host") ||
        AppConfigRepository.WEB_GATEWAY_DEFAULTS.sshHost,
      sshPort: this.readInteger(
        values.get("ssh_port"),
        AppConfigRepository.WEB_GATEWAY_DEFAULTS.sshPort
      ),
      sshUser: values.get("ssh_user") || "",
      identityFile: values.get("identity_file") || "",
      baseDomain:
        values.get("base_domain") ||
        AppConfigRepository.WEB_GATEWAY_DEFAULTS.baseDomain,
      publicIp:
        values.get("public_ip") ||
        AppConfigRepository.WEB_GATEWAY_DEFAULTS.publicIp,
      remotePortMin: this.readInteger(
        values.get("remote_port_min"),
        AppConfigRepository.WEB_GATEWAY_DEFAULTS.remotePortMin
      ),
      remotePortMax: this.readInteger(
        values.get("remote_port_max"),
        AppConfigRepository.WEB_GATEWAY_DEFAULTS.remotePortMax
      ),
      caddySitesDirectory:
        values.get("caddy_sites_directory") ||
        AppConfigRepository.WEB_GATEWAY_DEFAULTS.caddySitesDirectory,
      caddyConfigPath:
        values.get("caddy_config_path") ||
        AppConfigRepository.WEB_GATEWAY_DEFAULTS.caddyConfigPath,
      useSudo: this.readBoolean(
        values.get("use_sudo"),
        AppConfigRepository.WEB_GATEWAY_DEFAULTS.useSudo
      )
    };
  }

  public getWebProjectRoot(): string {
    return this.getNamespace("web_projects").get("root_path") || "";
  }

  public saveWebProjectRoot(rootPath: string): void {
    this.upsert("web_projects", "root_path", "string", rootPath);
  }

  public saveWebGatewayConfig(config: WebGatewayConfig): void {
    this.upsert("web_gateway", "ssh_host", "string", config.sshHost);
    this.upsert("web_gateway", "ssh_port", "integer", String(config.sshPort));
    this.upsert("web_gateway", "ssh_user", "string", config.sshUser);
    this.upsert("web_gateway", "identity_file", "string", config.identityFile);
    this.upsert("web_gateway", "base_domain", "string", config.baseDomain);
    this.upsert("web_gateway", "public_ip", "string", config.publicIp);
    this.upsert(
      "web_gateway",
      "remote_port_min",
      "integer",
      String(config.remotePortMin)
    );
    this.upsert(
      "web_gateway",
      "remote_port_max",
      "integer",
      String(config.remotePortMax)
    );
    this.upsert(
      "web_gateway",
      "caddy_sites_directory",
      "string",
      config.caddySitesDirectory
    );
    this.upsert(
      "web_gateway",
      "caddy_config_path",
      "string",
      config.caddyConfigPath
    );
    this.upsert("web_gateway", "use_sudo", "boolean", String(config.useSudo));
  }

  public hasNedbMigrationMarker(): boolean {
    const result = this.database
      .prepare(
        `SELECT EXISTS(
           SELECT 1
           FROM t_frpcd_app_config
           WHERE scope_type = 'global'
             AND scope_id IS NULL
             AND namespace = 'migration'
             AND config_key = 'nedb_v2_imported'
             AND config_value = 'true'
             AND deleted_at IS NULL
         ) AS found`
      )
      .get() as { found: number };
    return result.found === 1;
  }

  public saveNedbMigrationMarker(): void {
    this.upsert("migration", "nedb_v2_imported", "boolean", "true");
  }

  public deleteAll(): void {
    this.database.prepare("DELETE FROM t_frpcd_app_config").run();
  }

  private upsert(
    namespace: string,
    key: string,
    valueType: string,
    value: string
  ): void {
    const now = new Date().toISOString();
    const existing = this.database
      .prepare(
        `SELECT id
         FROM t_frpcd_app_config
         WHERE scope_type = 'global'
           AND scope_id IS NULL
           AND namespace = ?
           AND config_key = ?
           AND deleted_at IS NULL`
      )
      .get(namespace, key) as { id: string } | undefined;

    if (existing) {
      this.database
        .prepare(
          `UPDATE t_frpcd_app_config
           SET value_type = ?,
               config_value = ?,
               version = version + 1,
               updated_at = ?
           WHERE id = ?`
        )
        .run(valueType, value, now, existing.id);
      return;
    }

    this.database
      .prepare(
        `INSERT INTO t_frpcd_app_config (
           id, scope_type, scope_id, namespace, config_key,
           value_type, config_value, is_secret, encryption_type,
           version, created_at, updated_at, deleted_at
         ) VALUES (?, 'global', NULL, ?, ?, ?, ?, 0, NULL, 1, ?, ?, NULL)`
      )
      .run(IdUtils.genUUID(), namespace, key, valueType, value, now, now);
  }

  private getNamespace(namespace: string): Map<string, string> {
    const rows = this.database
      .prepare(
        `SELECT config_key, config_value
         FROM t_frpcd_app_config
         WHERE scope_type = 'global'
           AND scope_id IS NULL
           AND namespace = ?
           AND deleted_at IS NULL`
      )
      .all(namespace) as AppConfigRow[];
    return new Map(rows.map(row => [row.config_key, row.config_value]));
  }

  private readBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) {
      return fallback;
    }
    if (value !== "true" && value !== "false") {
      throw new Error("Invalid boolean value in desktop application config.");
    }
    return value === "true";
  }

  private readInteger(value: string | undefined, fallback: number): number {
    if (value === undefined) {
      return fallback;
    }
    const result = Number(value);
    if (!Number.isSafeInteger(result)) {
      throw new Error("Invalid integer value in application config.");
    }
    return result;
  }
}

export default AppConfigRepository;
