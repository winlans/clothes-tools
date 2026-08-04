import {
  DEFAULT_GUIDE_DETECTION_OPTIONS,
  type PatternLayoutProjectV1,
  type ProjectGuideSettings,
  type ProjectOutputSettings,
  type ProjectView,
} from "@pdf2plt/core";
import { defineStore } from "pinia";

type ProjectStatus = "idle" | "opening" | "ready" | "saving" | "error";

function defaultGuides(): ProjectGuideSettings {
  return {
    mode: "auto",
    outerLeft: 0,
    outerTop: 0,
    detection: { ...DEFAULT_GUIDE_DETECTION_OPTIONS },
  };
}

function defaultOutput(): ProjectOutputSettings {
  return { keepGuides: false, keepBackground: false, allowUnusedPages: false };
}

export const useProjectStore = defineStore("project", {
  state: () => ({
    status: "idle" as ProjectStatus,
    projectPath: undefined as string | undefined,
    projectFileName: "",
    pendingProject: undefined as PatternLayoutProjectV1 | undefined,
    activeProject: undefined as PatternLayoutProjectV1 | undefined,
    guideSettings: defaultGuides(),
    outputSettings: defaultOutput(),
    view: undefined as ProjectView | undefined,
    errorMessage: "",
    successMessage: "",
  }),
  actions: {
    beginOpen(project: PatternLayoutProjectV1, projectPath?: string, fileName = "") {
      this.status = "opening";
      this.pendingProject = project;
      this.activeProject = undefined;
      this.projectPath = projectPath;
      this.projectFileName = fileName;
      this.errorMessage = "";
      this.successMessage = "";
    },
    completeOpen(project: PatternLayoutProjectV1) {
      this.pendingProject = undefined;
      this.activeProject = project;
      this.guideSettings = { ...project.guides, detection: { ...project.guides.detection } };
      this.outputSettings = { ...project.output };
      this.view = { ...project.view };
      this.status = "ready";
      this.successMessage = `工程已打开：${this.projectFileName || "未命名工程"}`;
      this.errorMessage = "";
    },
    startNewDocument() {
      this.status = "idle";
      this.projectPath = undefined;
      this.projectFileName = "";
      this.pendingProject = undefined;
      this.activeProject = undefined;
      this.guideSettings = defaultGuides();
      this.outputSettings = defaultOutput();
      this.view = undefined;
      this.errorMessage = "";
      this.successMessage = "";
    },
    setView(camera: { scale: number; x: number; y: number }) {
      this.view = { zoom: camera.scale, panX: camera.x, panY: camera.y };
    },
    setGuideSettings(settings: ProjectGuideSettings) {
      this.guideSettings = { ...settings, detection: { ...settings.detection } };
    },
    setOutputSettings(settings: ProjectOutputSettings) {
      this.outputSettings = { ...settings };
    },
    beginSave() {
      this.status = "saving";
      this.errorMessage = "";
      this.successMessage = "";
    },
    completeSave(project: PatternLayoutProjectV1, path?: string, fileName = "") {
      this.activeProject = project;
      this.projectPath = path;
      this.projectFileName = fileName || this.projectFileName;
      this.status = "ready";
      this.successMessage = `工程已保存：${this.projectFileName || "工程文件"}`;
      this.errorMessage = "";
    },
    fail(message: string) {
      this.pendingProject = undefined;
      this.status = "error";
      this.errorMessage = message;
      this.successMessage = "";
    },
    clearMessages() {
      this.errorMessage = "";
      this.successMessage = "";
      if (this.status === "error") this.status = this.activeProject ? "ready" : "idle";
    },
  },
});
