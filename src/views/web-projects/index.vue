<script lang="ts" setup>
import Breadcrumb from "@/layout/compoenets/Breadcrumb.vue";
import { on, send } from "@/utils/ipcUtils";
import { ElMessage, FormInstance, FormRules } from "element-plus";
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ipcRouters } from "../../../electron/core/IpcRouter";

defineOptions({ name: "WebProjectsPage" });

const WEB_ROOT = "/Volumes/Box-1T/Web";
const { t } = useI18n();
const projects = ref<WebProjectView[]>([]);
const loading = ref(false);
const busyIds = ref<string[]>([]);
const editVisible = ref(false);
const editFormRef = ref<FormInstance>();
const editForm = reactive<WebProjectUpdate>({
  _id: "",
  name: "",
  startScript: "start",
  port: 3000,
  autoStart: false
});
const editingProject = computed(() =>
  projects.value.find(project => project._id === editForm._id)
);

const logVisible = ref(false);
const logProject = ref<WebProjectView | null>(null);
const logContent = ref("");

const frpVisible = ref(false);
const frpProject = ref<WebProjectView | null>(null);
const frpForm = reactive({
  type: "tcp" as "tcp" | "http",
  remotePort: 10000,
  domain: ""
});

const editRules = reactive<FormRules>({
  name: [
    {
      required: true,
      message: t("webProjects.validation.name"),
      trigger: "blur"
    }
  ],
  startScript: [
    {
      required: true,
      message: t("webProjects.validation.script"),
      trigger: "change"
    }
  ],
  port: [
    {
      type: "number",
      required: true,
      min: 1,
      max: 65535,
      message: t("webProjects.validation.port"),
      trigger: "change"
    }
  ]
});

const request = <T,>(router: IpcRouter, params?: unknown): Promise<T> =>
  new Promise((resolve, reject) => {
    let cleanup = () => {};
    cleanup = on(
      router,
      data => {
        cleanup();
        resolve(data as T);
      },
      (_bizCode, message) => {
        cleanup();
        reject(new Error(message));
      }
    );
    send(router, params);
  });

const replaceProject = (updated: WebProjectView) => {
  const index = projects.value.findIndex(
    project => project._id === updated._id
  );
  if (index >= 0) {
    projects.value[index] = updated;
  }
};

const runProjectAction = async (
  project: WebProjectView,
  router: IpcRouter,
  messageKey: string
) => {
  if (busyIds.value.includes(project._id)) return;
  busyIds.value.push(project._id);
  try {
    const updated = await request<WebProjectView>(router, { id: project._id });
    replaceProject(updated);
    ElMessage.success(t(messageKey));
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    busyIds.value = busyIds.value.filter(id => id !== project._id);
  }
};

const loadProjects = async (notify = false) => {
  loading.value = true;
  try {
    projects.value = await request<WebProjectView[]>(
      ipcRouters.WEB_PROJECT.scan
    );
    if (notify) ElMessage.success(t("webProjects.message.scanned"));
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    loading.value = false;
  }
};

const refreshStatus = async () => {
  try {
    projects.value = await request<WebProjectView[]>(
      ipcRouters.WEB_PROJECT.list
    );
    if (logVisible.value && logProject.value) {
      await loadLog(logProject.value);
    }
  } catch {
    // Background refresh stays quiet; explicit actions surface errors.
  }
};

const openEdit = (project: WebProjectView) => {
  Object.assign(editForm, {
    _id: project._id,
    name: project.name,
    startScript: project.startScript,
    port: project.port,
    autoStart: project.autoStart
  });
  editVisible.value = true;
};

const saveProject = async () => {
  if (!(await editFormRef.value?.validate())) return;
  try {
    const updated = await request<WebProjectView>(
      ipcRouters.WEB_PROJECT.update,
      { ...editForm }
    );
    replaceProject(updated);
    editVisible.value = false;
    ElMessage.success(t("webProjects.message.saved"));
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
};

const loadLog = async (project: WebProjectView) => {
  const result = await request<WebProjectLog>(ipcRouters.WEB_PROJECT.getLog, {
    id: project._id
  });
  logContent.value = result.content;
};

const openLog = async (project: WebProjectView) => {
  logProject.value = project;
  logVisible.value = true;
  try {
    await loadLog(project);
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
};

const openDirectory = async (project: WebProjectView) => {
  try {
    await request<void>(ipcRouters.WEB_PROJECT.openDirectory, {
      id: project._id
    });
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
};

const openService = async (project: WebProjectView) => {
  try {
    await request<void>(ipcRouters.SYSTEM.openUrl, {
      url: `http://127.0.0.1:${project.port}`
    });
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
};

const openFrp = (project: WebProjectView) => {
  frpProject.value = project;
  frpForm.type = "tcp";
  frpForm.remotePort = Math.min(65535, project.port + 10000);
  frpForm.domain = "";
  frpVisible.value = true;
};

const createFrpProxy = async () => {
  const project = frpProject.value;
  if (!project) return;
  if (
    frpForm.type === "tcp" &&
    (!Number.isInteger(frpForm.remotePort) ||
      frpForm.remotePort < 1 ||
      frpForm.remotePort > 65535)
  ) {
    ElMessage.warning(t("webProjects.validation.remotePort"));
    return;
  }
  if (frpForm.type === "http" && !frpForm.domain.trim()) {
    ElMessage.warning(t("webProjects.validation.domain"));
    return;
  }

  const safeName =
    project.name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-|-$/g, "") || `web-${project.port}`;
  const proxy: FrpcProxy = {
    _id: "",
    name: `web-${safeName}`,
    type: frpForm.type,
    localIP: "127.0.0.1",
    localPort: String(project.port),
    remotePort: String(frpForm.remotePort),
    customDomains: frpForm.type === "http" ? [frpForm.domain.trim()] : [""],
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

  try {
    await request<FrpcProxy>(ipcRouters.PROXY.createProxy, proxy);
    frpVisible.value = false;
    ElMessage.success(t("webProjects.message.proxyCreated"));
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
};

const statusType = (status: WebProjectRuntimeStatus) => {
  if (status === "running") return "success";
  if (status === "error" || status === "missing") return "danger";
  return "info";
};

const isBusy = (project: WebProjectView) => busyIds.value.includes(project._id);
let refreshTimer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  await loadProjects();
  refreshTimer = setInterval(refreshStatus, 2000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
  <div class="main">
    <Breadcrumb>
      <el-button type="primary" :loading="loading" @click="loadProjects(true)">
        {{ t("webProjects.refresh") }}
      </el-button>
    </Breadcrumb>

    <div class="app-container-breadcrumb web-project-page" v-loading="loading">
      <p class="root-hint">{{ t("webProjects.root", { path: WEB_ROOT }) }}</p>

      <el-empty
        v-if="!loading && projects.length === 0"
        :description="t('webProjects.emptyTitle')"
      >
        <p class="empty-description">
          {{ t("webProjects.emptyDescription", { path: WEB_ROOT }) }}
        </p>
        <el-button type="primary" @click="loadProjects(true)">
          {{ t("webProjects.refresh") }}
        </el-button>
      </el-empty>

      <div v-else class="project-grid">
        <article
          v-for="project in projects"
          :key="project._id"
          class="project-card"
        >
          <div class="project-header">
            <div class="project-title-wrap">
              <h2>{{ project.name }}</h2>
              <p :title="project.path">{{ project.path }}</p>
            </div>
            <el-tag :type="statusType(project.status)" effect="light">
              {{ t(`webProjects.status.${project.status}`) }}
            </el-tag>
          </div>

          <dl class="project-meta">
            <div>
              <dt>{{ t("webProjects.field.script") }}</dt>
              <dd>npm run {{ project.startScript }}</dd>
            </div>
            <div>
              <dt>{{ t("webProjects.field.port") }}</dt>
              <dd>{{ project.port }}</dd>
            </div>
            <div>
              <dt>{{ t("webProjects.field.pid") }}</dt>
              <dd>{{ project.pid || "—" }}</dd>
            </div>
          </dl>

          <el-alert
            v-if="project.lastError"
            :title="project.lastError"
            type="error"
            :closable="false"
            show-icon
          />

          <div class="project-actions">
            <el-button
              v-if="project.status !== 'running'"
              type="primary"
              :loading="isBusy(project)"
              :disabled="project.status === 'missing'"
              @click="
                runProjectAction(
                  project,
                  ipcRouters.WEB_PROJECT.start,
                  'webProjects.message.started'
                )
              "
            >
              {{ t("webProjects.action.start") }}
            </el-button>
            <el-button
              v-else
              type="danger"
              plain
              :loading="isBusy(project)"
              @click="
                runProjectAction(
                  project,
                  ipcRouters.WEB_PROJECT.stop,
                  'webProjects.message.stopped'
                )
              "
            >
              {{ t("webProjects.action.stop") }}
            </el-button>
            <el-button
              :disabled="project.status !== 'running'"
              :loading="isBusy(project)"
              @click="
                runProjectAction(
                  project,
                  ipcRouters.WEB_PROJECT.restart,
                  'webProjects.message.restarted'
                )
              "
            >
              {{ t("webProjects.action.restart") }}
            </el-button>
            <el-button @click="openEdit(project)">
              {{ t("webProjects.action.edit") }}
            </el-button>
            <el-dropdown trigger="click">
              <el-button>{{ t("common.more") }}</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="openLog(project)">
                    {{ t("webProjects.action.log") }}
                  </el-dropdown-item>
                  <el-dropdown-item @click="openDirectory(project)">
                    {{ t("webProjects.action.folder") }}
                  </el-dropdown-item>
                  <el-dropdown-item
                    :disabled="project.status !== 'running'"
                    @click="openService(project)"
                  >
                    {{ t("webProjects.action.open") }}
                  </el-dropdown-item>
                  <el-dropdown-item divided @click="openFrp(project)">
                    {{ t("webProjects.action.frp") }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </article>
      </div>
    </div>

    <el-drawer
      v-model="editVisible"
      :title="t('webProjects.editTitle')"
      size="420px"
    >
      <el-form
        ref="editFormRef"
        :model="editForm"
        :rules="editRules"
        label-position="top"
      >
        <el-form-item :label="t('webProjects.field.path')">
          <el-input :model-value="editingProject?.path" disabled />
        </el-form-item>
        <el-form-item prop="name" :label="t('common.name')">
          <el-input v-model="editForm.name" />
        </el-form-item>
        <el-form-item prop="startScript" :label="t('webProjects.field.script')">
          <el-select v-model="editForm.startScript" class="w-full">
            <el-option
              v-for="script in editingProject?.availableScripts || []"
              :key="script"
              :label="`npm run ${script}`"
              :value="script"
            />
          </el-select>
        </el-form-item>
        <el-form-item prop="port" :label="t('webProjects.field.port')">
          <el-input-number
            v-model="editForm.port"
            :min="1"
            :max="65535"
            class="w-full"
          />
        </el-form-item>
        <el-form-item :label="t('webProjects.field.autoStart')">
          <el-switch v-model="editForm.autoStart" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">{{
          t("common.cancel")
        }}</el-button>
        <el-button type="primary" @click="saveProject">
          {{ t("webProjects.action.save") }}
        </el-button>
      </template>
    </el-drawer>

    <el-drawer
      v-model="logVisible"
      :title="t('webProjects.logTitle', { name: logProject?.name || '' })"
      size="60%"
    >
      <pre v-if="logContent" class="log-content">{{ logContent }}</pre>
      <el-empty v-else :description="t('webProjects.logEmpty')" />
    </el-drawer>

    <el-dialog
      v-model="frpVisible"
      :title="t('webProjects.frpTitle', { name: frpProject?.name || '' })"
      width="480px"
    >
      <el-alert
        :title="t('webProjects.frp.hint', { port: frpProject?.port || '' })"
        type="info"
        :closable="false"
        class="mb-4"
      />
      <el-form :model="frpForm" label-position="top">
        <el-form-item :label="t('webProjects.frp.type')">
          <el-radio-group v-model="frpForm.type">
            <el-radio-button value="tcp">{{
              t("webProjects.frp.tcp")
            }}</el-radio-button>
            <el-radio-button value="http">{{
              t("webProjects.frp.http")
            }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item
          v-if="frpForm.type === 'tcp'"
          :label="t('webProjects.frp.remotePort')"
        >
          <el-input-number
            v-model="frpForm.remotePort"
            :min="1"
            :max="65535"
            class="w-full"
          />
        </el-form-item>
        <el-form-item v-else :label="t('webProjects.frp.domain')">
          <el-input
            v-model="frpForm.domain"
            :placeholder="t('webProjects.frp.domainPlaceholder')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="frpVisible = false">{{
          t("common.cancel")
        }}</el-button>
        <el-button type="primary" @click="createFrpProxy">
          {{ t("webProjects.frp.create") }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style lang="scss" scoped>
.web-project-page {
  padding-right: 8px;
}

.root-hint {
  margin-bottom: 12px;
  color: #6b7280;
  font-size: 12px;
  user-select: text;
}

.empty-description {
  margin: -16px 0 16px;
  color: #6b7280;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 12px;
}

.project-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 16px;
  border-left: 5px solid #5f3bb0;
  border-radius: 4px;
  background: #fff;
  filter: drop-shadow(0 2px 4px rgb(0 0 0 / 8%));
}

.project-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.project-title-wrap {
  min-width: 0;

  h2 {
    color: #5f3bb0;
    font-size: 16px;
    font-weight: 700;
  }

  p {
    overflow: hidden;
    margin-top: 4px;
    color: #6b7280;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: text;
  }
}

.project-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;

  div {
    padding: 8px;
    border-radius: 4px;
    background: #f3f3f3;
  }

  dt {
    color: #6b7280;
    font-size: 12px;
  }

  dd {
    overflow: hidden;
    margin-top: 4px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.project-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  :deep(.el-button + .el-button) {
    margin-left: 0;
  }
}

.log-content {
  min-height: 320px;
  margin: 0;
  padding: 14px;
  overflow: auto;
  border-radius: 4px;
  background: #111827;
  color: #e5e7eb;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  user-select: text;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 960px) {
  .project-grid {
    grid-template-columns: 1fr;
  }
}
</style>
