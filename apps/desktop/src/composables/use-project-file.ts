import {
  createRelativeSourcePath,
  parsePatternLayoutProject,
  serializePatternLayoutProject,
  type PatternLayoutProjectV1,
  type ProjectGuideSettings,
} from "@pdf2plt/core";
import { isTauri } from "@tauri-apps/api/core";
import { dirname, resolve as resolvePath } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import { sha256Hex } from "../project/fingerprint";
import { useGuideStore } from "../stores/guides";
import { useLayoutStore } from "../stores/layout";
import { usePdfDocumentStore } from "../stores/pdf-document";
import { useProjectStore } from "../stores/project";

function projectName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "") + ".pattern-layout.json";
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function pickBrowserFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    let settled = false;
    const finish = (file?: File) => {
      if (settled) return;
      settled = true;
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0]), { once: true });
    input.addEventListener("cancel", () => finish(), { once: true });
    input.click();
  });
}

async function readMatchingPdf(
  path: string,
  expectedSha256: string,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  try {
    const bytes = await readFile(path);
    return (await sha256Hex(bytes)) === expectedSha256 ? bytes : undefined;
  } catch {
    return undefined;
  }
}

export function useProjectFile() {
  const documentStore = usePdfDocumentStore();
  const layoutStore = useLayoutStore();
  const guideStore = useGuideStore();
  const projectStore = useProjectStore();

  async function openDesktopProject() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "pdf2plt 工程", extensions: ["pattern-layout.json", "json"] }],
    });
    if (!selected) return;

    try {
      const project = parsePatternLayoutProject(await readTextFile(selected));
      projectStore.beginOpen(project, selected, fileNameFromPath(selected));
      const directory = await dirname(selected);
      const candidates: string[] = [];
      if (project.source.relativePath) {
        candidates.push(await resolvePath(directory, project.source.relativePath));
      }
      if (project.source.absolutePath && !candidates.includes(project.source.absolutePath)) {
        candidates.push(project.source.absolutePath);
      }

      for (const candidate of candidates) {
        const bytes = await readMatchingPdf(candidate, project.source.sha256);
        if (bytes) {
          await documentStore.open(bytes, fileNameFromPath(candidate), candidate);
          return;
        }
      }

      const reselected = await open({
        multiple: false,
        directory: false,
        title: "源 PDF 缺失或不匹配，请重新选择",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!reselected) {
        projectStore.fail("未找到与工程匹配的源 PDF，请重新打开工程并选择源文件。");
        return;
      }
      const bytes = await readFile(reselected);
      if ((await sha256Hex(bytes)) !== project.source.sha256) {
        projectStore.fail("所选 PDF 的 SHA-256 与工程记录不一致，未替换源文件。");
        return;
      }
      await documentStore.open(bytes, fileNameFromPath(reselected), reselected);
    } catch (error) {
      projectStore.fail(error instanceof Error ? error.message : "工程文件打开失败。");
    }
  }

  async function openBrowserProject() {
    const projectFile = await pickBrowserFile("application/json,.json,.pattern-layout.json");
    if (!projectFile) return;
    try {
      const project = parsePatternLayoutProject(await projectFile.text());
      projectStore.beginOpen(project, undefined, projectFile.name);
      const pdfFile = await pickBrowserFile("application/pdf,.pdf");
      if (!pdfFile) {
        projectStore.fail("浏览器无法直接读取工程路径，请选择工程对应的源 PDF。");
        return;
      }
      const bytes = new Uint8Array(await pdfFile.arrayBuffer());
      if ((await sha256Hex(bytes)) !== project.source.sha256) {
        projectStore.fail("所选 PDF 的 SHA-256 与工程记录不一致，未替换源文件。");
        return;
      }
      await documentStore.open(bytes, pdfFile.name);
    } catch (error) {
      projectStore.fail(error instanceof Error ? error.message : "工程文件打开失败。");
    }
  }

  function currentGuideSettings(): ProjectGuideSettings {
    const coordinates = guideStore.coordinates;
    const sources = Object.values(guideStore.lines).map((line) => line?.source);
    const mode = coordinates
      ? sources.includes("manual")
        ? "manual"
        : "auto"
      : "none";
    return {
      ...projectStore.guideSettings,
      mode,
      ...(coordinates
        ? {
            seamLeft: coordinates.left,
            seamRight: coordinates.right,
            seamTop: coordinates.top,
            seamBottom: coordinates.bottom,
          }
        : {}),
      detection: { ...projectStore.guideSettings.detection },
    };
  }

  function buildProject(path?: string): PatternLayoutProjectV1 {
    const info = documentStore.info;
    const layout = layoutStore.layout;
    if (!info || !layout || !documentStore.sourceSha256) {
      throw new Error("请先打开并完成解析 PDF。");
    }
    const sourcePath = documentStore.sourcePath ?? "";
    const relativePath = path && sourcePath
      ? createRelativeSourcePath(path, sourcePath)
      : `./${documentStore.fileName}`;
    return {
      schemaVersion: 1,
      source: {
        absolutePath: sourcePath,
        relativePath,
        sha256: documentStore.sourceSha256,
        pageCount: info.pageCount,
        pageSizePt: { ...info.pageSizePt },
      },
      layout: JSON.parse(JSON.stringify(layout)) as typeof layout,
      guides: currentGuideSettings(),
      output: { ...projectStore.outputSettings },
      view: projectStore.view
        ? { ...projectStore.view }
        : { zoom: 1, panX: 0, panY: 0 },
    };
  }

  async function saveProject() {
    if (!documentStore.info || !layoutStore.layout) return;
    projectStore.beginSave();
    try {
      if (isTauri()) {
        const selected = projectStore.projectPath ?? await save({
          defaultPath: projectName(documentStore.fileName),
          filters: [{ name: "pdf2plt 工程", extensions: ["pattern-layout.json", "json"] }],
        });
        if (!selected) {
          projectStore.clearMessages();
          return;
        }
        const project = buildProject(selected);
        await writeTextFile(selected, serializePatternLayoutProject(project));
        projectStore.completeSave(project, selected, fileNameFromPath(selected));
        return;
      }

      const fileName = projectStore.projectFileName || projectName(documentStore.fileName);
      const project = buildProject();
      const blob = new Blob([serializePatternLayoutProject(project)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      projectStore.completeSave(project, undefined, fileName);
    } catch (error) {
      projectStore.fail(error instanceof Error ? error.message : "工程保存失败。");
    }
  }

  return {
    isDesktop: isTauri(),
    openProject: isTauri() ? openDesktopProject : openBrowserProject,
    saveProject,
  };
}
