/** Bottom-corner now-playing box. */
import type { TrackInfo } from "../audio/music";

export class NowPlaying {
  private el: HTMLElement;
  private timer: number | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.id = "now-playing";
    this.el.setAttribute("aria-live", "polite");
    this.el.innerHTML =
      '<div class="disc" aria-hidden="true"></div><div class="meta"><small>NOW PLAYING</small><strong></strong><span></span></div>';
    document.body.appendChild(this.el);
  }

  /** Show the box for a couple seconds, then fade it away. */
  show(track: TrackInfo, seconds = 3.5) {
    this.el.querySelector("strong")!.textContent = track.title;
    this.el.querySelector("span")!.textContent = track.artist;
    this.el.classList.add("show");
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(
      () => this.el.classList.remove("show"),
      seconds * 1000,
    );
  }
}
