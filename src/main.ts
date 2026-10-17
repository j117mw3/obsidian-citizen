import { isRecord } from "./validation";
import { Notice, Plugin } from "obsidian";
import { ConstellationSettings, DEFAULT_SETTINGS, sanitizeSettings } from "./settings";
import { ConstellationSettingTab } from "./settingsTab";
import { ConstellationView, VIEW_TYPE } from "./view";
import { PERFORMANCE_SCENARIOS, type PerformanceScenario } from "./performanceCapture";

const RESETS_COLOURS: (keyof ConstellationSettings)[] = ["palette", "groupBy", "folderDepth"];

export default class ConstellationPlugin extends Plugin {
  settings: ConstellationSettings = { ...DEFAULT_SETTINGS };
  private saveTimer = 0;
  private rebuildTimer = 0;
  private pendingReset = false;

  async onload(): Promise<void> {
    const saved: unknown = await this.loadData();
    this.settings = sanitizeSettings(saved);
    if (isRecord(saved) && (typeof saved.settingsSchemaVersion !== "number" || saved.settingsSchemaVersion < this.settings.settingsSchemaVersion)) await this.saveData(this.settings);
    this.registerView(VIEW_TYPE, leaf => new ConstellationView(leaf, this));
    this.addRibbonIcon("orbit", "Open Citizen", () => void this.activate());
    this.addCommand({ id: "open", name: "Open graph", callback: () => void this.activate() });
    for(const scenario of PERFORMANCE_SCENARIOS)this.addCommand({id:`performance-${scenario}`,name:`Capture ${scenario.replace(/-/g," ")} performance`,callback:()=>void this.capturePerformance(scenario)});
    this.addSettingTab(new ConstellationSettingTab(this.app, this));
    // wait until the workspace has been restored, otherwise the saved layout would open over it
    this.app.workspace.onLayoutReady(() => { if (this.settings.openOnStartup) void this.activate(); });
  }

  onunload(): void {
    // Obsidian removes the registered view for us; just make sure the last change is on disk.
    window.clearTimeout(this.rebuildTimer);
    if (this.saveTimer) { window.clearTimeout(this.saveTimer); void this.saveData(this.settings); }
  }

  async activate(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  private views(): ConstellationView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map(l => l.view as ConstellationView);
  }

  private async capturePerformance(scenario:PerformanceScenario):Promise<void> {
    const view=this.views()[0];if(!view){new Notice("Open Citizen before capturing performance.");return;}
    let hash:string|null=null;
    try{const directory=this.manifest.dir??`${this.app.vault.configDir}/plugins/${this.manifest.id}`,bytes=await this.app.vault.adapter.readBinary(`${directory}/main.js`),digest=await window.crypto.subtle.digest("SHA-256",bytes);hash=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("");}catch{/* A bundle hash is optional when the adapter cannot read plugin files. */}
    if(!view.capturePerformance(scenario,hash)){new Notice("A performance capture is already running, or WebGL is unavailable.");return;}
    new Notice(`Capturing ${scenario} for 20 seconds: warm up for 5 seconds, then reproduce the action for 15 seconds. A local JSON profile will download when it finishes.`);
  }

  /**
   * Apply a settings change. Cheap changes show at once; saving and the (more expensive) vault
   * rebuild are debounced so dragging a slider or typing in a text box does not hammer the disk or the layout.
   */
  update(patch: Partial<ConstellationSettings>, rebuild = false): void {
    this.settings = sanitizeSettings({ ...this.settings, ...patch });
    this.views().forEach(v => v.applySettings(false));

    if (rebuild) {
      if (RESETS_COLOURS.some(k => k in patch)) this.pendingReset = true;
      window.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = window.setTimeout(() => {
        const reset = this.pendingReset; this.pendingReset = false;
        this.views().forEach(v => v.applySettings(true, reset));
      }, 400);
    }
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { this.saveTimer = 0; void this.saveData(this.settings); }, 600);
  }
}
