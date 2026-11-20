"use client";

import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button, Slider } from "@/components/kit";
import type { AssetCache, VideoPlayer, VideoState } from "@/lib/canvas/images";
import type { MediaElement } from "@/lib/canvas/schema";

/** Play/pause (and for videos: position and sound) in the selection toolbar. */
export function MediaControls({ el, cache }: { el: MediaElement; cache: AssetCache }) {
  if (el.type === "gif") {
    const playing = cache.gif(el.assetId)?.playing ?? false;
    return (
      <Button
        size="sm"
        variant="ghost"
        aria-label={playing ? "Pause GIF" : "Play GIF"}
        onClick={() => cache.toggle(el)}
      >
        {playing ? <Pause /> : <Play />} {playing ? "Pause" : "Play"}
      </Button>
    );
  }
  const player = cache.video(el.assetId);
  return player ? <VideoControls player={player} /> : null;
}

const NO_STATE: VideoState = { playing: false, currentTime: 0, duration: 0, muted: false, ready: false, error: false };

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function VideoControls({ player }: { player: VideoPlayer }) {
  const s = useSyncExternalStore(player.subscribe, player.getState, () => NO_STATE);
  if (s.error) return <span className="px-2 text-sm text-muted-foreground">Can&apos;t play this video</span>;
  return (
    <div className="flex items-center gap-1">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={s.playing ? "Pause video" : "Play video"}
        onClick={() => player.toggle()}
      >
        {s.playing ? <Pause /> : <Play />}
      </Button>
      <Slider
        aria-label="Position in video"
        className="w-28"
        min={0}
        max={Math.max(s.duration, 0.01)}
        step={0.1}
        value={s.currentTime}
        disabled={!s.duration}
        onValueChange={(v) => player.seek(v)}
      />
      <span className="w-[88px] text-center text-xs tabular-nums text-muted-foreground" aria-live="off">
        {clock(s.currentTime)} / {clock(s.duration)}
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={s.muted ? "Turn sound on" : "Mute"}
        aria-pressed={s.muted}
        onClick={() => player.setMuted(!s.muted)}
      >
        {s.muted ? <VolumeX /> : <Volume2 />}
      </Button>
    </div>
  );
}
