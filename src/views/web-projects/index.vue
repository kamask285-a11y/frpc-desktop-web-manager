<script lang="ts" setup>
import Breadcrumb from "@/layout/compoenets/Breadcrumb.vue";
import { on, send } from "@/utils/ipcUtils";
import { ElMessage, ElMessageBox, FormInstance, FormRules } from "element-plus";
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ipcRouters } from "../../../electron/core/IpcRouter";

defineOptions({ name: "WebProjectsPage" });

const WEB_ROOT = "/Volumes/Box-1T/Web";
const DOMAIN_PREFIX_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const { t } = useI18n();
const projects = ref<WebProjectView[]>([]);
const loading = ref(false);
const busyIds = ref<string[]>([]);

const editVisible = ref(false);
const editSaving = ref(false);
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

const gatewayVisible = ref(false);
const gatewaySaving = ref(false);
const gatewayTesting = ref(false);
const gatewayTrusting = ref(false);
const gatewayFormRef = ref<FormInstance>();
const gatewayResult = ref<WebGatewayConnectionResult | null>(null);
const gatewayForm = reactive<WebGatewayConfig>({
  sshHost: "43.154.60.195",
  sshPort: 22,
  sshUser: "",
  identityFile: "",
  baseDomain: "work.199227.xyz",
  publicIp: "43.154.60.195",
  remotePortMin: 20000,
  remotePortMax: 29999,
  caddySitesDirectory: "/etc/caddy/acli.d/sites",
  caddyConfigPath: "/etc/caddy/Caddyfile",
  useSudo: true
});

const publicVisible = ref(false);
const publicBusy = ref(false);
const publicFormRef = ref<FormInstance>();
const publicProject = ref<WebProjectView | null>(null);
const publicPreview = ref<WebPublicAccessPreview | null>(null);
const publicCheck = ref<WebPublicAccessCheck | null>(null);
const publicForm = reactive({ domainPrefix: "" });

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

const gatewayRules = reactive<FormRules>({
  sshHost: [
    {
      required: true,
      message: t("webProjects.gateway.validation.host"),
      trigger: "blur"
    }
  ],
  sshPort: [
    {
      type: "number",
      required: true,
      min: 1,
      max: 65535,
      message: t("webProjects.gateway.validation.port"),
      trigger: "change"
    }
  ],
  sshUser: [
    {
      required: true,
      message: t("webProjects.gateway.validation.user"),
      trigger: "blur"
    }
  ],
  baseDomain: [
    {
      required: true,
      message: t("webProjects.gateway.validation.domain"),
      trigger: "blur"
    }
  ],
  publicIp: [
    {
      required: true,
      message: t("webProjects.gateway.validation.ip"),
      trigger: "blur"
    }
  ],
  caddySitesDirectory: [
    {
      required: true,
      message: t("webProjects.gateway.validation.path"),
      trigger: "blur"
    }
  ],
  caddyConfigPath: [
    {
      required: true,
      message: t("webProjects.gateway.validation.path"),
      trigger: "blur"
    }
  ]
});

const publicRules = reactive<FormRules>({
  domainPrefix: [
    {
      required: true,
      pattern: DOMAIN_PREFIX_PATTERN,
      message: t("webProjects.publicAccess.validation.prefix"),
      trigger: "blur"
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
  if (index >= 0) projects.value[index] = updated;
  if (publicProject.value?._id === updated._id) publicProject.value = updated;
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
    if (logVisible.value && logProject.value) await loadLog(logProject.value);
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
  editSaving.value = true;
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
  } finally {
    editSaving.value = false;
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

const openUrl = async (url: string) => {
  try {
    await request<void>(ipcRouters.SYSTEM.openUrl, { url });
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
};

const loadGateway = async () => {
  const config = await request<WebGatewayConfig>(
    ipcRouters.WEB_GATEWAY.getConfig
  );
  Object.assign(gatewayForm, config);
};

const openGateway = async () => {
  gatewayResult.value = null;
  try {
    await loadGateway();
    gatewayVisible.value = true;
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
};

const saveGateway = async (notify = true) => {
  if (!(await gatewayFormRef.value?.validate())) return false;
  gatewaySaving.value = true;
  try {
    const config = await request<WebGatewayConfig>(
      ipcRouters.WEB_GATEWAY.saveConfig,
      { ...gatewayForm }
    );
    Object.assign(gatewayForm, config);
    if (notify) ElMessage.success(t("webProjects.gateway.saved"));
    return true;
  } catch (error) {
    ElMessage.error((error as Error).message);
    return false;
  } finally {
    gatewaySaving.value = false;
  }
};

const selectIdentityFile = async () => {
  try {
    const result = await request<{ canceled: boolean; path: string }>(
      ipcRouters.SYSTEM.selectLocalFile,
      { name: t("webProjects.gateway.identityFile"), extensions: ["*"] }
    );
    if (!result.canceled) gatewayForm.identityFile = result.path;
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
};

const trustHostKey = async () => {
  if (!(await saveGateway(false))) return;
  gatewayTrusting.value = true;
  try {
    const scan = await request<WebGatewayHostKeyScan>(
      ipcRouters.WEB_GATEWAY.scanHostKey
    );
    const fingerprints = scan.keys
      .map(key => `${key.algorithm}: ${key.fingerprint}`)
      .join("\n");
    await ElMessageBox.confirm(
      t("webProjects.gateway.hostKeyConfirm", {
        host: scan.host,
        fingerprints
      }),
      t("webProjects.gateway.hostKeyTitle"),
      {
        confirmButtonText: t("webProjects.gateway.trust"),
        cancelButtonText: t("common.cancel"),
        type: "warning"
      }
    );
    await request<WebGatewayHostKeyScan>(ipcRouters.WEB_GATEWAY.trustHostKey);
    ElMessage.success(t("webProjects.gateway.trusted"));
  } catch (error) {
    if (error !== "cancel") ElMessage.error((error as Error).message);
  } finally {
    gatewayTrusting.value = false;
  }
};

const testGateway = async () => {
  if (!(await saveGateway(false))) return;
  gatewayTesting.value = true;
  gatewayResult.value = null;
  try {
    gatewayResult.value = await request<WebGatewayConnectionResult>(
      ipcRouters.WEB_GATEWAY.testConnection
    );
    if (gatewayResult.value.sudoReady) {
      ElMessage.success(t("webProjects.gateway.connectionReady"));
    }
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    gatewayTesting.value = false;
  }
};

const defaultPrefix = (project: WebProjectView) =>
  project.name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63) || `web-${project.port}`;

const refreshPreview = async () => {
  const project = publicProject.value;
  if (!project || !DOMAIN_PREFIX_PATTERN.test(publicForm.domainPrefix)) {
    publicPreview.value = null;
    return;
  }
  try {
    publicPreview.value = await request<WebPublicAccessPreview>(
      ipcRouters.WEB_GATEWAY.preview,
      { id: project._id, domainPrefix: publicForm.domainPrefix }
    );
  } catch (error) {
    publicPreview.value = null;
    ElMessage.error((error as Error).message);
  }
};

const openPublicAccess = async (project: WebProjectView) => {
  publicProject.value = project;
  publicForm.domainPrefix = project.domainPrefix || defaultPrefix(project);
  publicPreview.value = null;
  publicCheck.value = null;
  publicVisible.value = true;
  await refreshPreview();
};

const publish = async () => {
  const project = publicProject.value;
  if (!project || !(await publicFormRef.value?.validate())) return;
  publicBusy.value = true;
  try {
    const result = await request<WebPublicAccessCheck>(
      ipcRouters.WEB_GATEWAY.publish,
      { id: project._id, domainPrefix: publicForm.domainPrefix }
    );
    publicCheck.value = result;
    replaceProject(result.project);
    ElMessage.success(t("webProjects.publicAccess.deployed"));
  } catch (error) {
    await refreshStatus();
    ElMessage.error((error as Error).message);
  } finally {
    publicBusy.value = false;
  }
};

const republish = async () => {
  const project = publicProject.value;
  const domainPrefix = project?.domainPrefix || publicForm.domainPrefix;
  if (!project || !domainPrefix) return;
  publicBusy.value = true;
  try {
    const result = await request<WebPublicAccessCheck>(
      ipcRouters.WEB_GATEWAY.publish,
      { id: project._id, domainPrefix }
    );
    publicCheck.value = result;
    replaceProject(result.project);
    ElMessage.success(t("webProjects.publicAccess.republished"));
  } catch (error) {
    await refreshStatus();
    ElMessage.error((error as Error).message);
  } finally {
    publicBusy.value = false;
  }
};

const checkPublicAccess = async (project = publicProject.value) => {
  if (!project) return;
  publicBusy.value = true;
  try {
    const result = await request<WebPublicAccessCheck>(
      ipcRouters.WEB_GATEWAY.check,
      { id: project._id }
    );
    publicCheck.value = result;
    replaceProject(result.project);
    ElMessage.success(t("webProjects.publicAccess.checked"));
  } catch (error) {
    await refreshStatus();
    ElMessage.error((error as Error).message);
  } finally {
    publicBusy.value = false;
  }
};

const unpublish = async (project: WebProjectView) => {
  try {
    await ElMessageBox.confirm(
      t("webProjects.publicAccess.removeConfirm", { fqdn: project.fqdn }),
      t("webProjects.publicAccess.removeTitle"),
      {
        confirmButtonText: t("webProjects.publicAccess.remove"),
        cancelButtonText: t("common.cancel"),
        type: "warning"
      }
    );
    publicBusy.value = true;
    const updated = await request<WebProjectView>(
      ipcRouters.WEB_GATEWAY.unpublish,
      { id: project._id }
    );
    replaceProject(updated);
    publicVisible.value = false;
    ElMessage.success(t("webProjects.publicAccess.removed"));
  } catch (error) {
    if (error !== "cancel") ElMessage.error((error as Error).message);
  } finally {
    publicBusy.value = false;
  }
};

const removeProject = async (project: WebProjectView) => {
  try {
    await ElMessageBox.confirm(
      t("webProjects.removeConfirm", {
        name: project.name,
        fqdn: project.fqdn || t("webProjects.publicAccess.notConfigured")
      }),
      t("webProjects.removeTitle"),
      {
        confirmButtonText: t("webProjects.action.remove"),
        cancelButtonText: t("common.cancel"),
        type: "warning"
      }
    );
    busyIds.value.push(project._id);
    await request<void>(ipcRouters.WEB_GATEWAY.removeProject, {
      id: project._id
    });
    projects.value = projects.value.filter(item => item._id !== project._id);
    ElMessage.success(t("webProjects.message.removed"));
  } catch (error) {
    if (error !== "cancel") ElMessage.error((error as Error).message);
  } finally {
    busyIds.value = busyIds.value.filter(id => id !== project._id);
  }
};

const runtimeStatusType = (status: WebProjectRuntimeStatus) => {
  if (status === "running") return "success";
  if (status === "error" || status === "missing") return "danger";
  return "info";
};

const publicStatusType = (status: WebPublicAccessStatus) => {
  if (status === "online") return "success";
  if (status === "deploying" || status === "waiting_dns") return "warning";
  if (status === "error" || status === "cleanup_pending") return "danger";
  return "info";
};

const yesNoType = (ready: boolean) => (ready ? "success" : "info");
const isBusy = (project: WebProjectView) => busyIds.value.includes(project._id);
let refreshTimer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  await loadProjects();
  await loadGateway().catch(() => {});
  refreshTimer = setInterval(refreshStatus, 2000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
  <div class="main">
    <Breadcrumb>
      <div class="toolbar-actions">
        <el-button @click="openGateway">
          {{ t("webProjects.gateway.action") }}
        </el-button>
        <el-button
          type="primary"
          :loading="loading"
          @click="loadProjects(true)"
        >
          {{ t("webProjects.refresh") }}
        </el-button>
      </div>
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
            <div class="status-tags">
              <el-tag :type="runtimeStatusType(project.status)" effect="light">
                {{ t(`webProjects.status.${project.status}`) }}
              </el-tag>
              <el-tag
                :type="publicStatusType(project.publicAccessStatus)"
                effect="plain"
              >
                {{
                  t(`webProjects.publicStatus.${project.publicAccessStatus}`)
                }}
              </el-tag>
            </div>
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

          <div v-if="project.fqdn" class="public-summary">
            <div>
              <span>{{ t("webProjects.publicAccess.domain") }}</span>
              <button type="button" @click="openUrl(`https://${project.fqdn}`)">
                {{ project.fqdn }}
              </button>
            </div>
            <div>
              <span>{{ t("webProjects.publicAccess.remotePort") }}</span>
              <strong>{{ project.remotePort }}</strong>
            </div>
          </div>

          <el-alert
            v-if="project.lastError || project.lastPublicAccessError"
            :title="project.lastError || project.lastPublicAccessError || ''"
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
            <el-button @click="openPublicAccess(project)">
              {{ t("webProjects.action.publicAccess") }}
            </el-button>
            <el-dropdown trigger="click">
              <el-button>{{ t("common.more") }}</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="openEdit(project)">
                    {{ t("webProjects.action.edit") }}
                  </el-dropdown-item>
                  <el-dropdown-item @click="openLog(project)">
                    {{ t("webProjects.action.log") }}
                  </el-dropdown-item>
                  <el-dropdown-item @click="openDirectory(project)">
                    {{ t("webProjects.action.folder") }}
                  </el-dropdown-item>
                  <el-dropdown-item
                    :disabled="project.status !== 'running'"
                    @click="openUrl(`http://127.0.0.1:${project.port}`)"
                  >
                    {{ t("webProjects.action.open") }}
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="project.fqdn"
                    divided
                    @click="unpublish(project)"
                  >
                    {{ t("webProjects.publicAccess.remove") }}
                  </el-dropdown-item>
                  <el-dropdown-item
                    :divided="!project.fqdn"
                    class="danger-item"
                    @click="removeProject(project)"
                  >
                    {{ t("webProjects.action.remove") }}
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
        <el-button type="primary" :loading="editSaving" @click="saveProject">
          {{ t("webProjects.action.save") }}
        </el-button>
      </template>
    </el-drawer>

    <el-drawer
      v-model="gatewayVisible"
      :title="t('webProjects.gateway.title')"
      size="520px"
    >
      <el-form
        ref="gatewayFormRef"
        :model="gatewayForm"
        :rules="gatewayRules"
        label-position="top"
      >
        <h2 class="h2">{{ t("webProjects.gateway.sshSection") }}</h2>
        <el-row :gutter="12">
          <el-col :span="16">
            <el-form-item
              prop="sshHost"
              :label="t('webProjects.gateway.sshHost')"
            >
              <el-input v-model="gatewayForm.sshHost" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item
              prop="sshPort"
              :label="t('webProjects.gateway.sshPort')"
            >
              <el-input-number
                v-model="gatewayForm.sshPort"
                :min="1"
                :max="65535"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item prop="sshUser" :label="t('webProjects.gateway.sshUser')">
          <el-input v-model="gatewayForm.sshUser" />
        </el-form-item>
        <el-form-item :label="t('webProjects.gateway.identityFile')">
          <el-input v-model="gatewayForm.identityFile">
            <template #append>
              <el-button @click="selectIdentityFile">
                {{ t("webProjects.gateway.select") }}
              </el-button>
            </template>
          </el-input>
          <p class="form-help">{{ t("webProjects.gateway.identityHint") }}</p>
        </el-form-item>
        <el-form-item :label="t('webProjects.gateway.useSudo')">
          <el-switch v-model="gatewayForm.useSudo" />
        </el-form-item>

        <h2 class="h2">{{ t("webProjects.gateway.publicSection") }}</h2>
        <el-form-item
          prop="baseDomain"
          :label="t('webProjects.gateway.baseDomain')"
        >
          <el-input v-model="gatewayForm.baseDomain" />
        </el-form-item>
        <el-form-item
          prop="publicIp"
          :label="t('webProjects.gateway.publicIp')"
        >
          <el-input v-model="gatewayForm.publicIp" />
        </el-form-item>
        <el-form-item :label="t('webProjects.gateway.remoteRange')">
          <el-input
            :model-value="`${gatewayForm.remotePortMin}-${gatewayForm.remotePortMax}`"
            disabled
          />
        </el-form-item>

        <h2 class="h2">{{ t("webProjects.gateway.caddySection") }}</h2>
        <el-form-item
          prop="caddySitesDirectory"
          :label="t('webProjects.gateway.sitesDirectory')"
        >
          <el-input v-model="gatewayForm.caddySitesDirectory" />
        </el-form-item>
        <el-form-item
          prop="caddyConfigPath"
          :label="t('webProjects.gateway.configPath')"
        >
          <el-input v-model="gatewayForm.caddyConfigPath" />
        </el-form-item>

        <el-alert
          v-if="gatewayResult"
          :title="gatewayResult.message"
          :type="gatewayResult.sudoReady ? 'success' : 'warning'"
          :closable="false"
          show-icon
        />
      </el-form>
      <template #footer>
        <div class="drawer-footer">
          <div>
            <el-button :loading="gatewayTrusting" @click="trustHostKey">
              {{ t("webProjects.gateway.trustHost") }}
            </el-button>
            <el-button :loading="gatewayTesting" @click="testGateway">
              {{ t("webProjects.gateway.test") }}
            </el-button>
          </div>
          <div>
            <el-button @click="gatewayVisible = false">{{
              t("common.cancel")
            }}</el-button>
            <el-button
              type="primary"
              :loading="gatewaySaving"
              @click="saveGateway()"
            >
              {{ t("webProjects.action.save") }}
            </el-button>
          </div>
        </div>
      </template>
    </el-drawer>

    <el-drawer
      v-model="publicVisible"
      :title="
        t('webProjects.publicAccess.title', { name: publicProject?.name || '' })
      "
      size="500px"
    >
      <el-form
        ref="publicFormRef"
        :model="publicForm"
        :rules="publicRules"
        label-position="top"
      >
        <el-alert
          :title="t('webProjects.publicAccess.hint')"
          type="info"
          :closable="false"
          class="mb-4"
        />
        <el-form-item
          prop="domainPrefix"
          :label="t('webProjects.publicAccess.prefix')"
        >
          <el-input
            v-model="publicForm.domainPrefix"
            :disabled="Boolean(publicProject?.fqdn)"
            @blur="refreshPreview"
          >
            <template #append>.{{ gatewayForm.baseDomain }}</template>
          </el-input>
        </el-form-item>

        <div v-if="publicPreview" class="preview-card">
          <dl>
            <div>
              <dt>{{ t("webProjects.publicAccess.domain") }}</dt>
              <dd>{{ publicPreview.fqdn }}</dd>
            </div>
            <div>
              <dt>{{ t("webProjects.publicAccess.localPort") }}</dt>
              <dd>{{ publicPreview.localPort }}</dd>
            </div>
            <div>
              <dt>{{ t("webProjects.publicAccess.remotePort") }}</dt>
              <dd>{{ publicPreview.remotePort }}</dd>
            </div>
          </dl>
          <h3>{{ t("webProjects.publicAccess.dnsTitle") }}</h3>
          <p class="dns-record">
            A&nbsp;&nbsp;{{ publicPreview.dnsName }}&nbsp;&nbsp;{{
              publicPreview.dnsValue
            }}
          </p>
        </div>

        <div v-if="publicProject?.fqdn" class="status-panel">
          <h2 class="h2">{{ t("webProjects.publicAccess.statusTitle") }}</h2>
          <el-descriptions :column="1" border>
            <el-descriptions-item
              :label="t('webProjects.publicAccess.frpBackend')"
            >
              <el-tag :type="yesNoType(Boolean(publicCheck?.backendReady))">
                {{ t(publicCheck?.backendReady ? "common.yes" : "common.no") }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item :label="t('webProjects.publicAccess.caddy')">
              <el-tag
                :type="
                  yesNoType(
                    Boolean(
                      publicCheck?.caddyConfigReady && publicCheck?.caddyActive
                    )
                  )
                "
              >
                {{
                  t(
                    publicCheck?.caddyConfigReady && publicCheck?.caddyActive
                      ? "common.yes"
                      : "common.no"
                  )
                }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item :label="t('webProjects.publicAccess.dns')">
              <el-tag :type="yesNoType(Boolean(publicCheck?.dnsReady))">
                {{ t(publicCheck?.dnsReady ? "common.yes" : "common.no") }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item :label="t('webProjects.publicAccess.https')">
              <el-tag :type="yesNoType(Boolean(publicCheck?.httpsReady))">
                {{ t(publicCheck?.httpsReady ? "common.yes" : "common.no") }}
              </el-tag>
            </el-descriptions-item>
          </el-descriptions>
        </div>
      </el-form>
      <template #footer>
        <div class="drawer-footer">
          <el-button
            v-if="publicProject?.fqdn"
            type="danger"
            plain
            :loading="publicBusy"
            @click="unpublish(publicProject)"
          >
            {{ t("webProjects.publicAccess.remove") }}
          </el-button>
          <span v-else></span>
          <div>
            <template v-if="publicProject?.fqdn">
              <el-button
                type="primary"
                :loading="publicBusy"
                @click="republish"
              >
                {{ t("webProjects.publicAccess.republish") }}
              </el-button>
              <el-button :loading="publicBusy" @click="checkPublicAccess()">
                {{ t("webProjects.publicAccess.check") }}
              </el-button>
            </template>
            <el-button
              v-else
              type="primary"
              :loading="publicBusy"
              @click="publish"
            >
              {{ t("webProjects.publicAccess.deploy") }}
            </el-button>
          </div>
        </div>
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
  </div>
</template>

<style lang="scss" scoped>
.web-project-page {
  padding-right: 8px;
}

.toolbar-actions,
.project-actions,
.status-tags,
.drawer-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.drawer-footer {
  justify-content: space-between;
  width: 100%;
}

.root-hint,
.form-help {
  color: #6b7280;
  font-size: 12px;
  user-select: text;
}

.root-hint {
  margin-bottom: 12px;
}

.form-help {
  margin-top: 4px;
}

.empty-description {
  margin: -16px 0 16px;
  color: #6b7280;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
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

.project-header,
.public-summary > div {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.status-tags {
  justify-content: flex-end;
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

.project-meta,
.preview-card dl {
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

.public-summary,
.preview-card {
  padding: 10px;
  border-radius: 4px;
  background: #eeebf6;
}

.public-summary {
  display: grid;
  gap: 6px;
  font-size: 12px;

  span {
    color: #6b7280;
  }

  button {
    overflow: hidden;
    max-width: 75%;
    color: #5f3bb0;
    font-weight: 600;
    text-decoration: underline;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.preview-card {
  margin-top: 8px;

  h3 {
    margin-top: 12px;
    font-size: 14px;
    font-weight: 600;
  }
}

.dns-record {
  margin-top: 6px;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  user-select: text;
  white-space: nowrap;
}

.status-panel {
  margin-top: 20px;
}

.project-actions :deep(.el-button + .el-button),
.toolbar-actions :deep(.el-button + .el-button),
.drawer-footer :deep(.el-button + .el-button) {
  margin-left: 0;
}

:deep(.danger-item) {
  color: var(--el-color-danger);
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
