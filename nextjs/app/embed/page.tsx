'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  RotateCcw,
  RotateCw,
  Server,
  Subtitles,
  Gauge,
  Check,
  X,
  Sparkles,
  PictureInPicture2,
} from 'lucide-react';

function EmbedContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id') || '155';
  const type = searchParams.get('type') || 'movie';
  const season = searchParams.get('season') || searchParams.get('s') || '1';
  const episode = searchParams.get('episode') || searchParams.get('e') || '1';
  const autoplay = searchParams.get('autoplay') !== '0';

  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRootRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const idleTimer = useRef<any>(null);
  const clickTimeout = useRef<any>(null);
  const lastTapSide = useRef<string | null>(null);

  const [sources, setSources] = useState<any[]>([]);
  const [subtitles, setSubtitles] = useState<any[]>([]);
  const [currentIdx, setCurrentIdx] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [bufferProgress, setBufferProgress] = useState<number>(0);
  const [statusTitle, setStatusTitle] = useState<string>('Finding Best Stream');
  const [statusSubtitle, setStatusSubtitle] = useState<string>('Querying parallel SSE providers...');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [mediaTitle, setMediaTitle] = useState<string>(`Loading ${type.toUpperCase()} #${id}...`);
  const [isIdle, setIsIdle] = useState<boolean>(false);

  // Tooltip & Scrubber
  const [hoverTime, setHoverTime] = useState<string>('00:00');
  const [hoverPos, setHoverPos] = useState<number>(0);
  const [showTooltip, setShowTooltip] = useState<boolean>(false);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);

  // Modals & Drawers
  const [activeModal, setActiveModal] = useState<'servers' | 'subtitles' | 'speed' | null>(null);
  const [subSearch, setSubSearch] = useState<string>('');
  const [activeSubIdx, setActiveSubIdx] = useState<string>('off');
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [ripple, setRipple] = useState<{ type: string; text?: string } | null>(null);

  // SSE Stream Lifecycle
  useEffect(() => {
    if (!id) return;

    setCurrentIdx(-1);
    setSources([]);
    setIsLoading(true);
    setStatusTitle('Finding Best Stream');
    setStatusSubtitle('Connecting to Next.js Route Handlers...');

    const sseUrl =
      type === 'tv'
        ? `/api/tv?id=${encodeURIComponent(id)}&season=${season}&episode=${episode}`
        : `/api/movie?id=${encodeURIComponent(id)}`;

    const es = new EventSource(sseUrl);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'meta') {
          if (data.meta?.title) setMediaTitle(data.meta.title);
          if (Array.isArray(data.subtitles)) setSubtitles(data.subtitles);
        }

        if (data.type === 'source') {
          setSources((prev) => {
            const next = [...prev, data.source];
            if (currentIdx === -1 && next.length === 1) {
              playStream(next, 0);
            }
            return next;
          });
        }

        if (data.type === 'done') {
          es.close();
        }
      } catch (err) {
        console.error('SSE Error:', err);
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

  const playStream = (list: any[], index: number) => {
    const src = list[index];
    if (!src || !videoRef.current) return;

    setCurrentIdx(index);
    setIsLoading(false);
    triggerToast(`Connected: ${src.label || src.source}`);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const video = videoRef.current;
    const isHls = src.url.includes('.m3u8') || src.type === 'hls' || src.url.includes('api?url=');

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });
      hlsRef.current = hls;
      hls.loadSource(src.url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoplay) video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          triggerAutoFallback(list, index);
        }
      });
    } else {
      video.src = src.url;
      if (autoplay) video.play().catch(() => {});
      video.onerror = () => triggerAutoFallback(list, index);
    }
  };

  const triggerAutoFallback = (list: any[], failedIdx: number) => {
    if (failedIdx + 1 < list.length) {
      triggerToast(`Switching to backup server #${failedIdx + 2}...`);
      playStream(list, failedIdx + 1);
    } else {
      setIsLoading(true);
      setStatusTitle('Playback Failed');
      setStatusSubtitle('All candidate servers exhausted.');
    }
  };

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3200);
  };

  // Idle timer auto-hiding
  const resetIdle = () => {
    setIsIdle(false);
    clearTimeout(idleTimer.current);
    if (isPlaying && !isScrubbing) {
      idleTimer.current = setTimeout(() => {
        setIsIdle(true);
        setActiveModal(null);
      }, 2800);
    }
  };

  // Video Actions
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
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

  const triggerRipple = (type: string, text?: string) => {
    setRipple({ type, text });
    setTimeout(() => setRipple(null), 500);
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
    triggerToast(`Speed: ${spd}x`);
  };

  const selectSubtitle = (idx: string) => {
    setActiveSubIdx(idx);
    if (!videoRef.current) return;
    const tracks = videoRef.current.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = idx !== 'off' && parseInt(idx) === i ? 'showing' : 'disabled';
    }
    setActiveModal(null);
    triggerToast(idx === 'off' ? 'Subtitles off' : `Subtitles: ${subtitles[parseInt(idx)]?.label || 'On'}`);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      playerRootRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else if (document.pictureInPictureEnabled) {
      await videoRef.current.requestPictureInPicture();
    }
  };

  // Double Click / Tap Skip
  const handleTap = (side: 'left' | 'center' | 'right') => {
    if (clickTimeout.current && lastTapSide.current === side) {
      clearTimeout(clickTimeout.current);
      clickTimeout.current = null;
      if (side === 'left') skipTime(-10);
      else if (side === 'right') skipTime(10);
      else toggleFullscreen();
    } else {
      lastTapSide.current = side;
      clickTimeout.current = setTimeout(() => {
        clickTimeout.current = null;
        if (side === 'center') togglePlay();
        else resetIdle();
      }, 250);
    }
  };

  const formatTime = (sec: number) => {
    const s = Math.floor(sec) || 0;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const remS = s % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${remS.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${remS.toString().padStart(2, '0')}`;
  };

  return (
    <div
      ref={playerRootRef}
      onMouseMove={resetIdle}
      className={`relative w-screen h-screen bg-black overflow-hidden flex items-center justify-center select-none ${
        isIdle ? 'cursor-none' : ''
      }`}
    >
      {/* HTML5 Video */}
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
          if (!videoRef.current || isScrubbing) return;
          const cur = videoRef.current.currentTime;
          const dur = videoRef.current.duration || 0;
          setCurrentTime(cur);
          setDuration(dur);
          if (videoRef.current.buffered.length > 0) {
            setBufferProgress((videoRef.current.buffered.end(videoRef.current.buffered.length - 1) / dur) * 100);
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

      {/* Tap Gesture Overlay for Double-Tap Skip */}
      <div className="absolute inset-0 z-10 grid grid-cols-3 cursor-pointer">
        <div onClick={() => handleTap('left')} className="h-full" />
        <div onClick={() => handleTap('center')} className="h-full" />
        <div onClick={() => handleTap('right')} className="h-full" />
      </div>

      {/* Center Action Ripple Indicator */}
      {ripple && (
        <div className="absolute z-30 pointer-events-none flex flex-col items-center justify-center animate-pulse">
          <div className="w-20 h-20 rounded-full bg-black/60 backdrop-blur-md border border-white/10 flex items-center justify-center text-white shadow-2xl">
            {ripple.type === 'play' && <Play className="w-10 h-10 fill-current ml-1" />}
            {ripple.type === 'pause' && <Pause className="w-10 h-10 fill-current" />}
            {ripple.type === 'rewind' && <RotateCcw className="w-10 h-10" />}
            {ripple.type === 'forward' && <RotateCw className="w-10 h-10" />}
          </div>
          {ripple.text && <span className="mt-2 text-xs font-bold tracking-wider text-slate-200">{ripple.text}</span>}
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm z-30">
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
          <div className="px-4 py-2.5 rounded-xl bg-slate-900/90 backdrop-blur-md text-xs text-white shadow-2xl flex items-center gap-2.5 border border-white/10">
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

      {/* Top Bar */}
      <div
        className={`absolute top-0 left-0 right-0 p-4 sm:p-5 flex items-center justify-between z-20 pointer-events-none bg-gradient-to-b from-black/85 via-black/30 to-transparent transition-opacity duration-300 ${
          isIdle ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <div className="flex items-center space-x-3 pointer-events-auto">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
            <Play className="w-3.5 h-3.5 fill-current ml-0.5 text-white" />
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

        <div className="flex items-center space-x-2 pointer-events-auto">
          <button
            onClick={() => setActiveModal(activeModal === 'servers' ? null : 'servers')}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-slate-900/80 backdrop-blur border border-white/10 hover:bg-white/10 text-xs transition"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-medium text-slate-200">
              {sources[currentIdx]?.label || sources[currentIdx]?.source || 'Servers'}
            </span>
          </button>
        </div>
      </div>

      {/* Bottom Bar */}
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
              style={{ width: `${bufferProgress}%` }}
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
            <button onClick={togglePlay} className="p-2 rounded-xl hover:bg-white/10 text-white transition">
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
            </button>
            <button onClick={() => skipTime(-10)} className="p-2 rounded-xl hover:bg-white/10 text-slate-300 hover:text-white transition">
              <RotateCcw className="w-4 h-4" />
            </button>
            <button onClick={() => skipTime(10)} className="p-2 rounded-xl hover:bg-white/10 text-slate-300 hover:text-white transition">
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Volume */}
            <div className="flex items-center space-x-2 group/vol">
              <button onClick={toggleMute} className="p-2 rounded-xl hover:bg-white/10 text-white transition">
                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
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
              className="px-2.5 py-1.5 rounded-xl hover:bg-white/10 text-slate-200 transition flex items-center gap-1.5 text-xs border border-white/5"
            >
              <Server className="w-4 h-4 text-indigo-400" />
              <span className="hidden md:inline font-medium">Servers</span>
            </button>

            {/* Subtitles */}
            <button
              onClick={() => setActiveModal(activeModal === 'subtitles' ? null : 'subtitles')}
              className="px-2.5 py-1.5 rounded-xl hover:bg-white/10 text-slate-200 transition flex items-center gap-1.5 text-xs border border-white/5"
            >
              <Subtitles className="w-4 h-4 text-indigo-400" />
              <span className="hidden md:inline font-medium">CC</span>
            </button>

            {/* Speed */}
            <button
              onClick={() => setActiveModal(activeModal === 'speed' ? null : 'speed')}
              className="px-2 py-1.5 rounded-xl hover:bg-white/10 text-slate-200 transition text-xs font-mono font-medium border border-white/5"
            >
              {playbackSpeed}x
            </button>

            {/* PiP */}
            <button onClick={togglePiP} className="p-2 rounded-xl hover:bg-white/10 text-slate-300 hover:text-white transition">
              <PictureInPicture2 className="w-4 h-4" />
            </button>

            {/* Fullscreen */}
            <button onClick={toggleFullscreen} className="p-2 rounded-xl hover:bg-white/10 text-slate-300 hover:text-white transition">
              <Maximize className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* MODAL: SERVERS */}
      {activeModal === 'servers' && (
        <div className="absolute bottom-20 right-4 sm:right-8 w-72 bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-2xl p-3.5 shadow-2xl z-40">
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200">Streaming Servers</span>
            <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {sources.map((src, i) => (
              <button
                key={i}
                onClick={() => {
                  playStream(sources, i);
                  setActiveModal(null);
                }}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs transition flex items-center justify-between ${
                  i === currentIdx ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center space-x-2 truncate">
                  <span className={`w-1.5 h-1.5 rounded-full ${i === currentIdx ? 'bg-white' : 'bg-indigo-400'}`} />
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

      {/* MODAL: SUBTITLES */}
      {activeModal === 'subtitles' && (
        <div className="absolute bottom-20 right-4 sm:right-8 w-80 bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-2xl p-3.5 shadow-2xl z-40">
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200">Subtitles / CC</span>
            <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <input
            type="text"
            placeholder="Search language..."
            value={subSearch}
            onChange={(e) => setSubSearch(e.target.value)}
            className="w-full bg-slate-950/70 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 mb-2 focus:outline-none focus:border-indigo-500"
          />
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

      {/* MODAL: SPEED */}
      {activeModal === 'speed' && (
        <div className="absolute bottom-20 right-4 sm:right-24 w-44 bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-2xl p-3 shadow-2xl z-40">
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
    <Suspense fallback={<div className="w-screen h-screen bg-black flex items-center justify-center text-slate-400 text-sm">Loading Modern Player...</div>}>
      <EmbedContent />
    </Suspense>
  );
}
