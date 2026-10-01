<script setup lang="ts">
import { computed } from "vue";
import { CheckCircle2Icon, DownloadIcon, LoaderCircleIcon, RefreshCwIcon } from "@lucide/vue";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Progress } from "./ui/progress";
import type { useAppUpdater } from "../composables/use-app-updater";
import { version } from "../../package.json";

const props = defineProps<{ updater: ReturnType<typeof useAppUpdater> }>();
const status = computed(() => ({
  idle: "检查是否有新版本", checking: "正在检查更新…", available: "发现新版本",
  downloading: "正在后台下载…", ready: "更新已下载，随时可以安装",
  installing: "正在安装并重启…", restart: "更新已安装，等待重启",
  "up-to-date": "当前已是最新版本", error: "检查更新失败",
})[props.updater.state.value]);
</script>

<template>
  <Dialog :open="updater.dialogOpen.value" @update:open="updater.setDialogOpen">
    <DialogContent
      class="update-dialog sm:max-w-[600px]"
      :show-close-button="!updater.isInstalling.value"
      @escape-key-down="(event) => { if (updater.isInstalling.value) event.preventDefault() }"
      @interact-outside="(event) => { if (updater.isInstalling.value) event.preventDefault() }"
    >
      <DialogHeader class="update-dialog__header">
        <DialogTitle class="flex items-center gap-2">
          <RefreshCwIcon class="size-4" /> 软件更新
          <Badge v-if="updater.update.value" variant="secondary">新版本可用</Badge>
        </DialogTitle>
        <DialogDescription>
          clothes-tools · 当前版本 {{ updater.update.value?.currentVersion || version }}
          <span v-if="updater.update.value"> → {{ updater.update.value.version }}</span>
        </DialogDescription>
      </DialogHeader>
      <div class="update-dialog__body">
        <p class="flex items-center gap-2" role="status" aria-live="polite">
          <LoaderCircleIcon v-if="updater.busy.value" class="size-4 animate-spin" />
          <CheckCircle2Icon v-else-if="['ready', 'up-to-date'].includes(updater.state.value)" class="size-4 text-primary" />
          {{ status }}
        </p>
        <div v-if="updater.update.value?.body" class="update-dialog__notes">{{ updater.update.value.body }}</div>
        <div v-if="updater.state.value === 'downloading'" class="update-dialog__progress">
          <Progress :model-value="updater.progress.value" aria-label="更新下载进度" />
          <span>{{ updater.progress.value === null ? '正在下载，大小未知…' : `${updater.progress.value}%` }}</span>
          <p>可以关闭此窗口继续工作。下载完成后由你决定何时安装。</p>
        </div>
        <p v-if="updater.state.value === 'ready'" class="text-muted-foreground">安装会重启应用，请先保存当前工作。</p>
        <Alert v-if="updater.installationBlockReason.value && updater.update.value">
          <AlertDescription>{{ updater.installationBlockReason.value }}</AlertDescription>
        </Alert>
        <Alert v-if="updater.error.value" variant="destructive">
          <AlertDescription>{{ updater.error.value }}</AlertDescription>
        </Alert>
      </div>
      <DialogFooter class="update-dialog__footer">
        <Button v-if="updater.update.value && !updater.busy.value && updater.state.value !== 'restart'" variant="ghost" @click="updater.ignoreVersion">忽略此版本</Button>
        <Button variant="outline" :disabled="updater.isInstalling.value" @click="updater.setDialogOpen(false)">
          {{ updater.state.value === 'downloading' ? '后台下载' : '稍后再说' }}
        </Button>
        <Button v-if="updater.state.value === 'ready' || updater.state.value === 'restart'" :disabled="Boolean(updater.installationBlockReason.value)" @click="updater.installUpdate">
          <RefreshCwIcon /> {{ updater.state.value === 'restart' ? '立即重启' : '重启并更新' }}
        </Button>
        <Button v-else-if="updater.state.value === 'available'" @click="updater.downloadUpdate(false)">
          <DownloadIcon /> {{ updater.error.value ? '重试下载' : '下载更新' }}
        </Button>
        <Button v-else :disabled="updater.busy.value || !updater.desktop" @click="updater.checkForUpdates(false)">
          <LoaderCircleIcon v-if="updater.busy.value" class="animate-spin" />
          {{ updater.isInstalling.value ? '正在安装…' : updater.state.value === 'downloading' ? '正在下载…' : '检查更新' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
