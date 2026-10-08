/** Licensed soundtrack playback: menu loop, in-game loop, goal stinger + now-playing hook.
 * Files live in public/music (copied from the user's docs folder, not committed conceptually):
 * - menu.mp3: Slushii - All I Need (main menu + start screen)
 * - game.mp3: Slushii - LUV U NEED U (in-game)
 * - goal.mp3: Rocket League - We Speak Chinese (best bit = goal stinger)
 */
export interface TrackInfo {
  title: string;
  artist: string;
}

const base = import.meta.env.BASE_URL;

export const TRACKS: Record<"menu" | "game", TrackInfo & { src: string }> = {
  menu: {
    title: "All I Need",
    artist: "Slushii",
    src: `${base}music/menu.mp3`,
  },
  game: {
    title: "LUV U NEED U",
    artist: "Slushii",
    src: `${base}music/game.mp3`,
  },
};

export const GOAL_TRACK: TrackInfo & { src: string } = {
  title: "We Speak Chinese",
  artist: "Rocket League",
  src: `${base}music/goal.mp3`,
};

/** Best bit of "We Speak Chinese": skip the slow intro straight to the drop.
 *  Tweak this number if you want an earlier/later cue. */
export const GOAL_STINGER_OFFSET = 44;
export const GOAL_STINGER_LENGTH = 3.4;

export type MusicContext = "menu" | "game";

export class MusicManager {
  onTrack: ((track: TrackInfo) => void) | null = null;
  private song = new Audio();
  private stinger = new Audio();
  private context: MusicContext | null = null;
  private stingerTimer: number | null = null;
  private unlocked = false;
  volume = 1;

  constructor() {
    this.song.preload = "auto";
    this.song.loop = true;
    this.stinger.preload = "auto";
    for (const el of [this.song, this.stinger]) {
      el.addEventListener("error", () => {
        console.warn("[music] could not load", (el as HTMLAudioElement).src);
      });
    }
  }

  /** Must be called from a user gesture at least once (autoplay policy). */
  unlock() {
    this.unlocked = true;
    if (this.context) void this.playContext(this.context, true);
  }

  setVolume(musicVolume: number) {
    this.volume = musicVolume;
    this.song.volume = musicVolume;
    this.stinger.volume = Math.min(1, musicVolume + 0.15);
  }

  async playContext(context: MusicContext, force = false) {
    if (!force && this.context === context && !this.song.paused) return;
    this.context = context;
    const track = TRACKS[context];
    if (this.song.src !== new URL(track.src, location.href).href) {
      this.song.src = track.src;
      this.song.loop = true;
      this.song.volume = this.volume;
    }
    this.onTrack?.({ title: track.title, artist: track.artist });
    if (!this.unlocked) return;
    try {
      // Duck the loop while the goal stinger is ringing.
      if (!this.stinger.paused) this.song.volume = this.volume * 0.25;
      await this.song.play();
    } catch {
      /* Autoplay blocked: will start on next unlock(). */
    }
  }

  /** Best-bit goal stinger: ducks the loop, fires the drop, then restores. */
  async goalStinger() {
    if (!this.unlocked) return;
    this.onTrack?.({ title: GOAL_TRACK.title, artist: GOAL_TRACK.artist });
    try {
      this.stinger.src = GOAL_TRACK.src;
      this.stinger.volume = Math.min(1, this.volume + 0.15);
      this.stinger.currentTime = GOAL_STINGER_OFFSET;
      this.song.volume = this.volume * 0.25;
      await this.stinger.play();
    } catch {
      return;
    }
    if (this.stingerTimer !== null) window.clearTimeout(this.stingerTimer);
    this.stingerTimer = window.setTimeout(() => {
      this.stinger.pause();
      if (this.context) this.song.volume = this.volume;
    }, GOAL_STINGER_LENGTH * 1000);
  }

  resumeLoop() {
    if (this.stingerTimer !== null) {
      window.clearTimeout(this.stingerTimer);
      this.stingerTimer = null;
    }
    this.stinger.pause();
    if (this.context) this.song.volume = this.volume;
  }
}
