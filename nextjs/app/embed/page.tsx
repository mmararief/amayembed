'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume2,
  Volume1,
  VolumeX,
  Settings,
  Subtitles,
  PictureInPicture2,
  Maximize,
  Minimize,
  Check,
  Server,
  Gauge,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';

function VidstackStylePlayer() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id') || '155';
  const type = searchParams.get('type') || 'movie';
  const season = searchParams.get('season') || searchParams.get('s') || '1';
  const episode = searchParams.get('episode') || searchParams.get('e') || '1';
  const autoplay = searchParams.get('autoplay') !== '0';

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const idleTimer = useRef<any>(null);

  // Mutable refs for stream state
  const sourcesRef = useRef<any[]>([]);
  const currentIdxRef = useRef<number>(-1);
  const hasStartedRef = useRef<boolean>(false);

  // Playback state
  const [sourcesList, setSourcesList] = useState<any[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const [subtitles, setSubtitles] = useState<any[]>([]);
  const [activeSubIdx, setActiveSubIdx] = useState<string>('off');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [bufferedEnd, setBufferedEnd] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isIdle, setIsIdle] = useState<boolean>(false);
  const [isVolumeHovered, setIsVolumeHovered] = useState<boolean>(false);
  const [showRemainingTime, setShowRemainingTime] = useState<boolean>(true);

  // Menus
  const [menuOpen, setMenuOpen] = useState<'settings' | 'servers' | 'speed' | 'subtitles' | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Auto-hide controls
  const resetIdle = () => {
    setIsIdle(false);
    clearTimeout(idleTimer.current);
    if (isPlaying && !menuOpen) {
      idleTimer.current = setTimeout(() => {
        setIsIdle(true);
      }, 2600);
    }
  };

  // Play a specific source
  const playSource = (idx: number) => {
    const list = sourcesRef.current;
    if (idx < 0 || idx >= list.length || !videoRef.current) return;

    currentIdxRef.current = idx;
    setActiveIdx(idx);

    const src = list[idx];
    const streamUrl = src.url;
    const isHls = streamUrl.includes('.m3u8') || src.type === 'hls' || streamUrl.includes('api?url=');

    console.log(`[Player] Playing #${idx + 1}: ${src.label || src.source} (isHls: ${isHls})`);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const video = videoRef.current;

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });
      hlsRef.current = hls;

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        if (autoplay) video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          triggerFallback();
        }
      });
    } else {
      video.src = streamUrl;
      video.load();

      video.onloadeddata = () => {
        setIsLoading(false);
        if (autoplay) video.play().catch(() => {});
      };

      video.onerror = () => {
        triggerFallback();
      };
    }
  };

  const triggerFallback = () => {
    const nextIdx = currentIdxRef.current + 1;
    if (nextIdx < sourcesRef.current.length) {
      playSource(nextIdx);
    } else {
      setIsLoading(true);
    }
  };

  // SSE Pipeline
  useEffect(() => {
    if (!id) return;

    sourcesRef.current = [];
    currentIdxRef.current = -1;
    hasStartedRef.current = false;
    setSourcesList([]);
    setActiveIdx(-1);
    setIsLoading(true);

    const sseUrl =
      type === 'tv'
        ? `/api/tv?id=${encodeURIComponent(id)}&season=${season}&episode=${episode}`
        : `/api/movie?id=${encodeURIComponent(id)}`;

    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'meta') {
          if (Array.isArray(data.subtitles)) setSubtitles(data.subtitles);
        }

        if (data.type === 'source') {
          sourcesRef.current.push(data.source);
          setSourcesList([...sourcesRef.current]);

          if (!hasStartedRef.current) {
            hasStartedRef.current = true;
            playSource(0);
          }
        }

        if (data.type === 'done') {
          es.close();
        }
      } catch (err) {
        console.error(err);
      }
    };

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
      if (hlsRef.current) hlsRef.current.destroy();
    };
  }, [id, type, season, episode]);

  // Controls
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) videoRef.current.play().catch(() => {});
    else videoRef.current.pause();
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  };

  const handleVolumeChange = (val: number) => {
    if (!videoRef.current) return;
    videoRef.current.volume = val;
    setVolume(val);
    videoRef.current.muted = val === 0;
    setIsMuted(val === 0);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (e) {}
  };

  const changeSpeed = (spd: number) => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = spd;
    setPlaybackSpeed(spd);
    setMenuOpen(null);
  };

  const selectSubtitle = (idx: string) => {
    setActiveSubIdx(idx);
    if (!videoRef.current) return;
    const tracks = videoRef.current.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = idx !== 'off' && parseInt(idx) === i ? 'showing' : 'disabled';
    }
    setMenuOpen(null);
  };

  const formatTime = (sec: number) => {
    const s = Math.floor(sec) || 0;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rem = s % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
    return `${m}:${rem.toString().padStart(2, '0')}`;
  };

  const formatRemaining = () => {
    const rem = Math.max(0, duration - currentTime);
    return `-${formatTime(rem)}`;
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={resetIdle}
      onClick={() => setMenuOpen(null)}
      className={`relative w-screen h-screen bg-black overflow-hidden flex items-center justify-center select-none font-sans ${
        isIdle ? 'cursor-none' : ''
      }`}
    >
      {/* 1. NATIVE <video> ENGINE */}
      <video
        ref={videoRef}
        playsInline
        crossOrigin="anonymous"
        onClick={(e) => {
          e.stopPropagation();
          togglePlay();
        }}
        onPlay={() => {
          setIsPlaying(true);
          resetIdle();
        }}
        onPause={() => {
          setIsPlaying(false);
          resetIdle();
        }}
        onTimeUpdate={() => {
          if (!videoRef.current) return;
          const cur = videoRef.current.currentTime;
          const dur = videoRef.current.duration || 0;
          setCurrentTime(cur);
          setDuration(dur);
          if (videoRef.current.buffered.length > 0) {
            setBufferedEnd(videoRef.current.buffered.end(videoRef.current.buffered.length - 1));
          }
        }}
        className="w-full h-full object-contain cursor-pointer"
      >
        {subtitles.map((sub, i) => (
          <track
            key={i}
            kind="subtitles"
            label={sub.label}
            src={sub.file}
            srcLang={(sub.label || 'en').toLowerCase().slice(0, 2)}
          />
        ))}
      </video>

      {/* Loading Spinner */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[2px] z-30 pointer-events-none">
          <div className="w-12 h-12 border-3 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* 2. THE EXACT MINIMALIST BOTTOM PILL BAR (MATCHING THE SCREENSHOT) */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute bottom-3 left-4 right-4 sm:left-6 sm:right-6 z-20 transition-all duration-300 pointer-events-auto ${
          isIdle ? 'opacity-0 translate-y-3 pointer-events-none' : 'opacity-100 translate-y-0'
        }`}
      >
        <div className="bg-black/60 hover:bg-black/75 backdrop-blur-md border border-white/10 rounded-xl px-3.5 py-2.5 flex items-center gap-3 text-white text-xs shadow-2xl transition-colors">
          {/* Play / Pause Button */}
          <button
            onClick={togglePlay}
            className="p-1 rounded-md hover:text-white text-slate-200 transition active:scale-95 focus:outline-none"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          {/* Volume with Hover Slider */}
          <div
            onMouseEnter={() => setIsVolumeHovered(true)}
            onMouseLeave={() => setIsVolumeHovered(false)}
            className="flex items-center gap-1.5"
          >
            <button
              onClick={toggleMute}
              className="p-1 rounded-md hover:text-white text-slate-200 transition focus:outline-none"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4" />
              ) : volume < 0.5 ? (
                <Volume1 className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <div
              className={`overflow-hidden transition-all duration-200 flex items-center ${
                isVolumeHovered ? 'w-16 opacity-100' : 'w-0 opacity-0'
              }`}
            >
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                className="w-14 h-1 bg-white/30 rounded-full cursor-pointer accent-white"
              />
            </div>
          </div>

          {/* Current Time Display */}
          <span className="font-mono text-[11px] text-slate-200 tracking-tight shrink-0">
            {formatTime(currentTime)}
          </span>

          {/* Scrubber Progress Bar (Middle Line) */}
          <div
            onClick={(e) => {
              if (!duration || !videoRef.current) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              videoRef.current.currentTime = pos * duration;
            }}
            className="relative flex-1 h-1 hover:h-1.5 bg-white/20 rounded-full cursor-pointer transition-all duration-150 group/scrub"
          >
            {/* Buffered */}
            <div
              style={{ width: `${duration ? (bufferedEnd / duration) * 100 : 0}%` }}
              className="absolute top-0 left-0 h-full rounded-full bg-white/30"
            />
            {/* Played (White Solid Bar) */}
            <div
              style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
              className="absolute top-0 left-0 h-full rounded-full bg-white flex items-center justify-end"
            >
              <div className="w-2.5 h-2.5 bg-white rounded-full scale-0 group-hover/scrub:scale-100 transition-transform shadow-md" />
            </div>
          </div>

          {/* Remaining / Total Time */}
          <button
            onClick={() => setShowRemainingTime(!showRemainingTime)}
            className="font-mono text-[11px] text-slate-300 hover:text-white tracking-tight shrink-0 transition"
          >
            {showRemainingTime ? formatRemaining() : formatTime(duration)}
          </button>

          {/* Settings Icon (Gear) */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(menuOpen === 'settings' ? null : 'settings')}
              className={`p-1 rounded-md transition focus:outline-none ${
                menuOpen === 'settings' || menuOpen === 'servers' || menuOpen === 'speed'
                  ? 'text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* Main Settings Menu Popover */}
            {menuOpen === 'settings' && (
              <div className="absolute bottom-11 right-0 w-52 bg-slate-950/95 border border-white/10 rounded-xl p-2 shadow-2xl text-xs space-y-1 backdrop-blur-xl">
                <button
                  onClick={() => setMenuOpen('servers')}
                  className="w-full px-2.5 py-2 rounded-lg hover:bg-white/10 flex items-center justify-between text-slate-200 transition"
                >
                  <span className="flex items-center gap-2">
                    <Server className="w-3.5 h-3.5 text-slate-400" />
                    <span>Server</span>
                  </span>
                  <div className="flex items-center gap-1 text-[11px] text-slate-400">
                    <span className="truncate max-w-[80px]">
                      {sourcesList[activeIdx]?.label || sourcesList[activeIdx]?.source || 'Auto'}
                    </span>
                    <ChevronRight className="w-3 h-3" />
                  </div>
                </button>

                <button
                  onClick={() => setMenuOpen('speed')}
                  className="w-full px-2.5 py-2 rounded-lg hover:bg-white/10 flex items-center justify-between text-slate-200 transition"
                >
                  <span className="flex items-center gap-2">
                    <Gauge className="w-3.5 h-3.5 text-slate-400" />
                    <span>Speed</span>
                  </span>
                  <div className="flex items-center gap-1 text-[11px] text-slate-400">
                    <span>{playbackSpeed}x</span>
                    <ChevronRight className="w-3 h-3" />
                  </div>
                </button>
              </div>
            )}

            {/* Servers Submenu */}
            {menuOpen === 'servers' && (
              <div className="absolute bottom-11 right-0 w-64 bg-slate-950/95 border border-white/10 rounded-xl p-2 shadow-2xl text-xs space-y-1 backdrop-blur-xl max-h-56 overflow-y-auto">
                <div className="text-[10px] uppercase font-bold text-slate-400 px-2 py-1 border-b border-white/10">
                  Select Server
                </div>
                {sourcesList.map((src, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      playSource(i);
                      setMenuOpen(null);
                    }}
                    className={`w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between transition ${
                      i === activeIdx ? 'bg-white/15 text-white font-medium' : 'text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    <span className="truncate">{src.label || src.source}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{src.quality || 'Auto'}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Speed Submenu */}
            {menuOpen === 'speed' && (
              <div className="absolute bottom-11 right-0 w-40 bg-slate-950/95 border border-white/10 rounded-xl p-2 shadow-2xl text-xs space-y-1 backdrop-blur-xl">
                <div className="text-[10px] uppercase font-bold text-slate-400 px-2 py-1 border-b border-white/10">
                  Playback Speed
                </div>
                {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((spd) => (
                  <button
                    key={spd}
                    onClick={() => changeSpeed(spd)}
                    className={`w-full px-2 py-1.5 rounded-lg flex items-center justify-between transition ${
                      playbackSpeed === spd ? 'bg-white/15 text-white font-semibold' : 'text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    <span>{spd}x {spd === 1.0 && '(Normal)'}</span>
                    {playbackSpeed === spd && <Check className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Subtitles / CC Icon */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(menuOpen === 'subtitles' ? null : 'subtitles')}
              className={`p-1 rounded-md transition focus:outline-none ${
                activeSubIdx !== 'off' ? 'text-white font-bold' : 'text-slate-300 hover:text-white'
              }`}
            >
              <Subtitles className="w-4 h-4" />
            </button>

            {menuOpen === 'subtitles' && (
              <div className="absolute bottom-11 right-0 w-56 bg-slate-950/95 border border-white/10 rounded-xl p-2 shadow-2xl text-xs space-y-1 backdrop-blur-xl max-h-56 overflow-y-auto">
                <div className="text-[10px] uppercase font-bold text-slate-400 px-2 py-1 border-b border-white/10">
                  Subtitles
                </div>
                <button
                  onClick={() => selectSubtitle('off')}
                  className={`w-full px-2 py-1.5 rounded-lg flex items-center justify-between transition ${
                    activeSubIdx === 'off' ? 'bg-white/15 text-white font-semibold' : 'text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <span>Off</span>
                  {activeSubIdx === 'off' && <Check className="w-3.5 h-3.5" />}
                </button>
                {subtitles.map((sub, i) => (
                  <button
                    key={i}
                    onClick={() => selectSubtitle(String(i))}
                    className={`w-full px-2 py-1.5 rounded-lg flex items-center justify-between truncate transition ${
                      activeSubIdx === String(i) ? 'bg-white/15 text-white font-semibold' : 'text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    <span className="truncate">{sub.label || `Track ${i + 1}`}</span>
                    {activeSubIdx === String(i) && <Check className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Picture in Picture */}
          <button
            onClick={togglePiP}
            className="p-1 rounded-md hover:text-white text-slate-300 transition focus:outline-none"
          >
            <PictureInPicture2 className="w-4 h-4" />
          </button>

          {/* Fullscreen Icon */}
          <button
            onClick={toggleFullscreen}
            className="p-1 rounded-md hover:text-white text-slate-300 transition focus:outline-none"
          >
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EmbedPage() {
  return (
    <Suspense
      fallback={
        <div className="w-screen h-screen bg-black flex items-center justify-center text-slate-400 text-xs font-mono">
          Loading Player...
        </div>
      }
    >
      <VidstackStylePlayer />
    </Suspense>
  );
}
