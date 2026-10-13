export interface PreparationJob {
  name: string;
  run: () => void | Promise<unknown>;
}
/** Resource readiness is separate from match rules: no physics tick occurs here. */
export class MatchLoading {
  readonly root = document.createElement("section");
  active = false;
  timings: { name: string; ms: number }[] = [];
  private generation = 0;
  private label = document.createElement("span");
  private bar = document.createElement("progress");
  constructor(parent: HTMLElement) {
    this.root.id = "match-loading";
    this.root.hidden = true;
    this.root.setAttribute("role", "status");
    this.root.setAttribute("aria-live", "polite");
    const title = document.createElement("strong");
    title.textContent = "LOADING MATCH";
    this.root.append(title, this.label, this.bar);
    parent.append(this.root);
  }
  cancel() {
    this.generation++;
    this.active = false;
    this.root.hidden = true;
  }
  private frame() {
    return new Promise<void>((resolve) =>
      requestAnimationFrame(() => setTimeout(resolve, 0)),
    );
  }
  async run(jobs: PreparationJob[], commit: () => void, onFailure: () => void) {
    if (this.active) return false;
    const token = ++this.generation;
    this.active = true;
    this.root.hidden = false;
    this.timings = [];
    this.bar.max = jobs.length;
    this.bar.value = 0;
    try {
      await this.frame();
      for (const job of jobs) {
        if (token !== this.generation) return false;
        this.label.textContent = job.name;
        await this.frame();
        const start = performance.now();
        await job.run();
        this.timings.push({ name: job.name, ms: performance.now() - start });
        this.bar.value++;
      }
      if (token !== this.generation) return false;
      this.label.textContent = "READY";
      await this.frame();
      if (token !== this.generation) return false;
      commit();
      this.active = false;
      this.root.hidden = true;
      return true;
    } catch (error) {
      if (token !== this.generation) return false;
      this.cancel();
      onFailure();
      console.error("Match preparation failed", error);
      return false;
    }
  }
}
