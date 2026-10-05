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
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
  Server,
  Subtitles,
  Check,
  X,
  Sparkles,
  PictureInPicture2,
  Film,
  Search,
} from 'lucide-react';

function CustomPlayerContent() {
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
  const clickTimer = useRef<any>(null);
  const lastTapSide = useRef<string | null>(null);

  // Mutable refs for robust state handling across async SSE events
  const sourcesRef = useRef<any[]>([]);
  const currentIdxRef = useRef<number>(-1);
  const hasStartedRef = useRef<boolean>(false);

  // UI state
  const [sourcesList, setSourcesList] = useState<any[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const [subtitles, setSubtitles] = useState<any[]>([]);
  const [activeSubIdx, setActiveSubIdx] = useState<string>('off');
  const [subSearch, setSubSearch] = useState<string>('');
  const [mediaTitle, setMediaTitle] = useState<string>(`Loading ${type.toUpperCase()} #${id}...`);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [bufferedEnd, setBufferedEnd] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isIdle, setIsIdle] = useState<boolean>(false);

  // Scrubber hover state
  const [hoverTime, setHoverTime] = useState<string>('00:00');
  const [hoverPos, setHoverPos] = useState<number>(0);
  const [showTooltip, setShowTooltip] = useState<boolean>(false);

  // Status & Feedback state
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [statusTitle, setStatusTitle] = useState<string>('Searching Best Stream');
  const [statusSubtitle, setStatusSubtitle] = useState<string>('Connecting to SSE pipeline...');
  const [activeModal, setActiveModal] = useState<'servers' | 'subtitles' | 'speed' | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [centerRipple, setCenterRipple] = useState<{ type: string; text?: string } | null>(null);

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3200);
  };

  const triggerRipple = (type: string, text?: string) => {
    setCenterRipple({ type, text });
    setTimeout(() => setCenterRipple(null), 450);
  };

  // Auto-hide controls when playing and idle
  const resetIdle = () => {
    setIsIdle(false);
    clearTimeout(idleTimer.current);
    if (isPlaying) {
      idleTimer.current = setTimeout(() => {
        setIsIdle(true);
        setActiveModal(null);
      }, 2800);
    }
  };

  // CORE ENGINE: Play stream using native <video> + Hls.js only if HLS
  const playSource = (idx: number) => {
    const list = sourcesRef.current;
    if (idx < 0 || idx >= list.length || !videoRef.current) return;

    currentIdxRef.current = idx;
    setActiveIdx(idx);

    const src = list[idx];
    const streamUrl = src.url;
    const isHls = streamUrl.includes('.m3u8') || src.type === 'hls' || streamUrl.includes('api?url=');

    console.log(`[Player] Loading source #${idx + 1} (${src.label || src.source}) | isHls: ${isHls}`);
    triggerToast(`Connected: ${src.label || src.source}`);

    // Clean up previous HLS instance if any
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const video = videoRef.current;

    if (isHls && Hls.isSupported()) {
      // 1. ENGINE: HLS.js for HLS streams on non-Safari browsers
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
        if (autoplay) {
          video.play().catch(() => {});
        }
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          console.warn('[Player] HLS fatal error, switching to fallback:', data);
          triggerAutoFallback();
        }
      });
    } else {
      // 2. ENGINE: Native <video> for direct MP4, MKV, or Safari native HLS
      video.src = streamUrl;
      video.load();

      video.onloadeddata = () => {
        setIsLoading(false);
        if (autoplay) {
          video.play().catch(() => {});
        }
      };

      video.onerror = () => {
        console.warn('[Player] Native video error, switching to fallback');
        triggerAutoFallback();
      };
    }
  };

  const triggerAutoFallback = () => {
    const nextIdx = currentIdxRef.current + 1;
    if (nextIdx < sourcesRef.current.length) {
      triggerToast(`Server failed. Trying backup #${nextIdx + 1}...`);
      playSource(nextIdx);
    } else {
      setIsLoading(true);
      setStatusTitle('All Servers Failed');
      setStatusSubtitle('All candidate streams were exhausted for this title.');
    }
  };

  // SSE Pipeline Lifecycle
  useEffect(() => {
    if (!id) return;

    // Reset state
    sourcesRef.current = [];
    currentIdxRef.current = -1;
    hasStartedRef.current = false;
    setSourcesList([]);
    setActiveIdx(-1);
    setIsLoading(true);
    setStatusTitle('Searching Best Stream');
    setStatusSubtitle('Querying parallel SSE providers...');

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
          if (data.meta?.title) setMediaTitle(data.meta.title);
          if (Array.isArray(data.subtitles)) {
            setSubtitles(data.subtitles);
          }
        }

        if (data.type === 'source') {
          sourcesRef.current.push(data.source);
          setSourcesList([...sourcesRef.current]);

          // Immediately start with first candidate!
          if (!hasStartedRef.current) {
            hasStartedRef.current = true;
            playSource(0);
          }
        }

        if (data.type === 'done') {
          es.close();
          if (sourcesRef.current.length === 0) {
            setIsLoading(true);
            setStatusTitle('No Playable Sources');
            setStatusSubtitle('All stream providers returned 0 candidates.');
          }
        }
      } catch (err) {
        console.error('SSE Error:', err);
      }
    };

    es.onerror = () => {
      es.close();
      if (sourcesRef.current.length === 0) {
        setIsLoading(true);
        setStatusTitle('Connection Error');
        setStatusSubtitle('Unable to receive stream data from server.');
      }
    };

    return () => {
      es.close();
      if (hlsRef.current) hlsRef.current.destroy();
    };
  }, [id, type, season, episode]);

  // Video Controls
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
      triggerRipple('play');
    } else {
      videoRef.current.pause();
      triggerRipple('pause');
    }
  };

  const skipTime = (sec: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(videoRef.current.currentTime + sec, duration));
    triggerRipple(sec > 0 ? 'forward' : 'rewind', `${sec > 0 ? '+' : ''}${sec}s`);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  };

  const changeVolume = (val: number) => {
    if (!videoRef.current) return;
    videoRef.current.volume = val;
    setVolume(val);
    videoRef.current.muted = val === 0;
    setIsMuted(val === 0);
  };

  const changeSpeed = (spd: number) => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = spd;
    setPlaybackSpeed(spd);
    setActiveModal(null);
    triggerToast(`Playback speed: ${spd}x`);
  };

  const selectSubtitle = (idx: string) => {
    setActiveSubIdx(idx);
    if (!videoRef.current) return;
    const tracks = videoRef.current.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = idx !== 'off' && parseInt(idx) === i ? 'showing' : 'disabled';
    }
    setActiveModal(null);
    triggerToast(idx === 'off' ? 'Subtitles off' : `Subtitles: ${subtitles[parseInt(idx)]?.label || 'Active'}`);
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

  // Double-tap skip gesture
  const handleTap = (side: 'left' | 'center' | 'right') => {
    if (clickTimer.current && lastTapSide.current === side) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      if (side === 'left') skipTime(-10);
      else if (side === 'right') skipTime(10);
      else toggleFullscreen();
    } else {
      lastTapSide.current = side;
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        if (side === 'center') togglePlay();
        else resetIdle();
      }, 250);
    }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space' || e.code === 'KeyK') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyJ') {
        skipTime(-10);
      } else if (e.code === 'ArrowRight' || e.code === 'KeyL') {
        skipTime(10);
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        changeVolume(Math.min(1, volume + 0.1));
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        changeVolume(Math.max(0, volume - 0.1));
      } else if (e.code === 'KeyM') {
        toggleMute();
      } else if (e.code === 'KeyF') {
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [volume, duration, isPlaying]);

  const formatTime = (sec: number) => {
    const s = Math.floor(sec) || 0;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rem = s % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={resetIdle}
      className={`relative w-screen h-screen bg-black overflow-hidden flex items-center justify-center select-none ${
        isIdle ? 'cursor-none' : ''
      }`}
    >
      {/* 1. NATIVE <video> ENGINE */}
      <video
        ref={videoRef}
        playsInline
        crossOrigin="anonymous"
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

      {/* 2. GESTURE OVERLAY (Double-Click Skip Left / Center / Right) */}
      <div className="absolute inset-0 z-10 grid grid-cols-3 cursor-pointer">
        <div onClick={() => handleTap('left')} className="h-full" />
        <div onClick={() => handleTap('center')} className="h-full" />
        <div onClick={() => handleTap('right')} className="h-full" />
      </div>

      {/* Center Action Ripple Indicator */}
      {centerRipple && (
        <div className="absolute z-30 pointer-events-none flex flex-col items-center justify-center animate-pulse">
          <div className="w-20 h-20 rounded-full bg-black/60 backdrop-blur-md border border-white/10 flex items-center justify-center text-white shadow-2xl">
            {centerRipple.type === 'play' && <Play className="w-10 h-10 fill-current ml-1" />}
            {centerRipple.type === 'pause' && <Pause className="w-10 h-10 fill-current" />}
            {centerRipple.type === 'rewind' && <RotateCcw className="w-10 h-10" />}
            {centerRipple.type === 'forward' && <RotateCw className="w-10 h-10" />}
          </div>
          {centerRipple.text && (
            <span className="mt-2 text-xs font-bold tracking-wider text-slate-200">{centerRipple.text}</span>
          )}
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm z-30 pointer-events-none">
          <div className="relative flex items-center justify-center mb-4">
            <div className="w-16 h-16 rounded-full border-4 border-indigo-500/20 border-t-indigo-500 animate-spin" />
            <div className="absolute w-8 h-8 rounded-full bg-indigo-600/30 blur-md animate-pulse" />
          </div>
          <h3 className="text-sm font-semibold tracking-wider text-slate-100 uppercase">{statusTitle}</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xs text-center font-mono">{statusSubtitle}</p>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && (
        <div className="absolute top-5 right-5 z-40 transition-all duration-300">
          <div className="px-4 py-2 rounded-xl bg-slate-900/90 backdrop-blur-md text-xs text-white shadow-2xl flex items-center gap-2.5 border border-white/10">
            <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="font-medium">{toastMsg}</span>
          </div>
        </div>
      )}

      {/* Hover Scrubber Tooltip */}
      {showTooltip && (
        <div
          style={{ left: `${hoverPos}px` }}
          className="absolute bottom-20 z-40 bg-slate-900/95 text-[11px] font-mono px-2 py-1 rounded text-white border border-slate-700 pointer-events-none transform -translate-x-1/2 shadow-xl"
        >
          {hoverTime}
        </div>
      )}

      {/* 3. CUSTOM TOP BAR */}
      <div
        className={`absolute top-0 left-0 right-0 p-4 sm:p-5 flex items-center justify-between z-20 pointer-events-none bg-gradient-to-b from-black/85 via-black/30 to-transparent transition-opacity duration-300 ${
          isIdle ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <div className="flex items-center space-x-3 pointer-events-auto">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
            <Film className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-xs sm:text-sm font-bold text-white tracking-wide truncate max-w-[200px] sm:max-w-md">
              {mediaTitle}
            </h1>
            <p className="text-[10px] text-slate-400 font-mono">
              TMDB #{id} {type === 'tv' && `• S${season} E${episode}`}
            </p>
          </div>
        </div>

        {/* Server Selector Trigger */}
        <div className="flex items-center space-x-2 pointer-events-auto">
          <button
            onClick={() => setActiveModal(activeModal === 'servers' ? null : 'servers')}
            className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-slate-900/80 backdrop-blur border border-white/10 hover:bg-white/10 text-xs transition"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-medium text-slate-200">
              {sourcesList[activeIdx]?.label || sourcesList[activeIdx]?.source || 'Auto Server'}
            </span>
          </button>
        </div>
      </div>

      {/* 4. CUSTOM BOTTOM CONTROLS BAR */}
      <div
        className={`absolute bottom-0 left-0 right-0 p-4 sm:p-5 flex flex-col justify-end space-y-3 z-20 pointer-events-none bg-gradient-to-t from-black/90 via-black/40 to-transparent transition-opacity duration-300 ${
          isIdle ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {/* Scrubber Progress Bar */}
        <div className="w-full pointer-events-auto py-2">
          <div
            onMouseMove={(e) => {
              if (!duration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              setHoverTime(formatTime(pos * duration));
              setHoverPos(e.clientX);
              setShowTooltip(true);
            }}
            onMouseLeave={() => setShowTooltip(false)}
            onClick={(e) => {
              if (!duration || !videoRef.current) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              videoRef.current.currentTime = pos * duration;
            }}
            className="relative h-1.5 hover:h-2.5 rounded-full bg-white/20 cursor-pointer transition-all duration-150"
          >
            {/* Buffered */}
            <div
              style={{ width: `${duration ? (bufferedEnd / duration) * 100 : 0}%` }}
              className="absolute top-0 left-0 h-full rounded-full bg-white/35 transition-all duration-200"
            />
            {/* Played */}
            <div
              style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
              className="absolute top-0 left-0 h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 shadow-md"
            />
          </div>
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between pointer-events-auto">
          {/* Left Controls */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            <button onClick={togglePlay} className="p-2 rounded-xl hover:bg-white/10 text-white transition active:scale-95">
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
            </button>
            <button onClick={() => skipTime(-10)} className="p-2 rounded-xl hover:bg-white/10 text-slate-300 hover:text-white transition active:scale-95">
              <RotateCcw className="w-4 h-4" />
            </button>
            <button onClick={() => skipTime(10)} className="p-2 rounded-xl hover:bg-white/10 text-slate-300 hover:text-white transition active:scale-95">
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Volume */}
            <div className="flex items-center space-x-2 group/vol">
              <button onClick={toggleMute} className="p-2 rounded-xl hover:bg-white/10 text-white transition">
                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : volume < 0.5 ? <Volume1 className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <div className="w-0 group-hover/vol:w-16 overflow-hidden transition-all duration-200 flex items-center">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => changeVolume(parseFloat(e.target.value))}
                  className="w-14 h-1 bg-white/30 rounded cursor-pointer accent-indigo-500"
                />
              </div>
            </div>

            {/* Time */}
            <div className="text-[11px] font-mono text-slate-300 pl-1">
              <span>{formatTime(currentTime)}</span>
              <span className="text-slate-500"> / </span>
              <span className="text-slate-400">{formatTime(duration)}</span>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center space-x-1.5 sm:space-x-2">
            {/* Servers */}
            <button
              onClick={() => setActiveModal(activeModal === 'servers' ? null : 'servers')}
              className="px-2.5 py-1.5 rounded-xl hover:bg-white/10 text-slate-200 transition flex items-center gap-1.5 text-xs border border-white/5 active:scale-95"
            >
              <Server className="w-4 h-4 text-indigo-400" />
              <span className="hidden md:inline font-medium">Servers ({sourcesList.length})</span>
            </button>

            {/* Subtitles */}
            <button
              onClick={() => setActiveModal(activeModal === 'subtitles' ? null : 'subtitles')}
              className="px-2.5 py-1.5 rounded-xl hover:bg-white/10 text-slate-200 transition flex items-center gap-1.5 text-xs border border-white/5 active:scale-95"
            >
              <Subtitles className="w-4 h-4 text-indigo-400" />
              <span className="hidden md:inline font-medium">CC</span>
            </button>

            {/* Speed */}
            <button
              onClick={() => setActiveModal(activeModal === 'speed' ? null : 'speed')}
              className="px-2 py-1.5 rounded-xl hover:bg-white/10 text-slate-200 transition text-xs font-mono font-medium border border-white/5 active:scale-95"
            >
              {playbackSpeed}x
            </button>

            {/* PiP */}
            <button onClick={togglePiP} className="p-2 rounded-xl hover:bg-white/10 text-slate-300 hover:text-white transition active:scale-95">
              <PictureInPicture2 className="w-4 h-4" />
            </button>

            {/* Fullscreen */}
            <button onClick={toggleFullscreen} className="p-2 rounded-xl hover:bg-white/10 text-slate-300 hover:text-white transition active:scale-95">
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* 5. MODAL: SERVERS DRAWER */}
      {activeModal === 'servers' && (
        <div className="absolute bottom-20 right-4 sm:right-8 w-72 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl z-40">
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">Available Servers</span>
            </div>
            <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {sourcesList.map((src, i) => (
              <button
                key={i}
                onClick={() => {
                  playSource(i);
                  setActiveModal(null);
                }}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs transition flex items-center justify-between ${
                  i === activeIdx ? 'bg-indigo-600 text-white font-semibold shadow-md' : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center space-x-2 truncate">
                  <span className={`w-1.5 h-1.5 rounded-full ${i === activeIdx ? 'bg-white' : 'bg-indigo-400'}`} />
                  <span className="truncate">{src.label || src.source}</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 border border-white/10">
                  {src.quality || 'Auto'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 6. MODAL: SUBTITLES DRAWER */}
      {activeModal === 'subtitles' && (
        <div className="absolute bottom-20 right-4 sm:right-8 w-80 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl z-40">
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
            <div className="flex items-center gap-2">
              <Subtitles className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">Subtitles / CC</span>
            </div>
            <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="relative mb-2">
            <input
              type="text"
              placeholder="Search language..."
              value={subSearch}
              onChange={(e) => setSubSearch(e.target.value)}
              className="w-full bg-slate-950/70 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 pl-8"
            />
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
          </div>
          <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
            <button
              onClick={() => selectSubtitle('off')}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-white/10 flex justify-between ${
                activeSubIdx === 'off' ? 'text-indigo-400 font-bold' : 'text-slate-300'
              }`}
            >
              <span>Off</span>
              {activeSubIdx === 'off' && <Check className="w-3.5 h-3.5" />}
            </button>
            {subtitles
              .filter((s) => (s.label || '').toLowerCase().includes(subSearch.toLowerCase()))
              .map((sub, i) => (
                <button
                  key={i}
                  onClick={() => selectSubtitle(String(i))}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-white/10 flex justify-between truncate ${
                    activeSubIdx === String(i) ? 'text-indigo-400 font-bold' : 'text-slate-300'
                  }`}
                >
                  <span className="truncate">{sub.label || `Track ${i + 1}`}</span>
                  {activeSubIdx === String(i) && <Check className="w-3.5 h-3.5" />}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* 7. MODAL: SPEED DRAWER */}
      {activeModal === 'speed' && (
        <div className="absolute bottom-20 right-4 sm:right-24 w-44 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-3 shadow-2xl z-40">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-white/10 pb-2 mb-2">
            Playback Speed
          </div>
          <div className="space-y-1">
            {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((spd) => (
              <button
                key={spd}
                onClick={() => changeSpeed(spd)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-white/10 flex justify-between ${
                  playbackSpeed === spd ? 'font-bold text-indigo-400' : 'text-slate-300'
                }`}
              >
                <span>{spd}x {spd === 1.0 && '(Normal)'}</span>
                {playbackSpeed === spd && <Check className="w-3.5 h-3.5" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function EmbedPage() {
  return (
    <Suspense
      fallback={
        <div className="w-screen h-screen bg-black flex items-center justify-center text-slate-400 text-sm">
          Loading Custom Player...
        </div>
      }
    >
      <CustomPlayerContent />
    </Suspense>
  );
}
