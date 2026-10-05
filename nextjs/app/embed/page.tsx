'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Hls from 'hls.js';
import { Play, Pause, Volume2, VolumeX, Maximize, RotateCcw, RotateCw, Server, Subtitles } from 'lucide-react';

function EmbedContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id') || '155';
  const type = searchParams.get('type') || 'movie';
  const season = searchParams.get('season') || searchParams.get('s') || '1';
  const episode = searchParams.get('episode') || searchParams.get('e') || '1';
  const autoplay = searchParams.get('autoplay') !== '0';

  const videoRef = useRef<HTMLVideoElement>(null);
  const [sources, setSources] = useState<any[]>([]);
  const [subtitles, setSubtitles] = useState<any[]>([]);
  const [currentIdx, setCurrentIdx] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [status, setStatus] = useState<string>('Searching stream candidates...');
  const [showServers, setShowServers] = useState<boolean>(false);
  const [showSubtitles, setShowSubtitles] = useState<boolean>(false);
  const [activeSubtitle, setActiveSubtitle] = useState<string>('off');
  const [isIdle, setIsIdle] = useState<boolean>(false);

  const hlsRef = useRef<Hls | null>(null);
  const idleTimer = useRef<any>(null);

  // SSE stream lifecycle
  useEffect(() => {
    if (!id) return;

    setCurrentIdx(-1);
    setSources([]);
    setStatus('Querying providers via Next.js Route Handler...');

    const sseUrl = type === 'tv'
      ? `/api/tv?id=${encodeURIComponent(id)}&season=${season}&episode=${episode}`
      : `/api/movie?id=${encodeURIComponent(id)}`;

    const es = new EventSource(sseUrl);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'meta') {
          if (Array.isArray(data.subtitles)) {
            setSubtitles(data.subtitles);
          }
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
      } catch (e) {
        console.error('SSE Error:', e);
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
    setStatus(`Connected: ${src.label || src.source}`);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const video = videoRef.current;
    const isHls = src.url.includes('.m3u8') || src.type === 'hls' || src.url.includes('api?url=');

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.loadSource(src.url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoplay) video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          triggerFallback(list, index);
        }
      });
    } else {
      video.src = src.url;
      if (autoplay) video.play().catch(() => {});
      video.onerror = () => triggerFallback(list, index);
    }
  };

  const triggerFallback = (list: any[], failedIdx: number) => {
    if (failedIdx + 1 < list.length) {
      playStream(list, failedIdx + 1);
    } else {
      setStatus('Playback failed. All candidate servers exhausted.');
    }
  };

  const resetIdle = () => {
    setIsIdle(false);
    clearTimeout(idleTimer.current);
    if (isPlaying) {
      idleTimer.current = setTimeout(() => setIsIdle(true), 3000);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) videoRef.current.play();
    else videoRef.current.pause();
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  const formatTime = (sec: number) => {
    const s = Math.floor(sec) || 0;
    const m = Math.floor(s / 60);
    return `${m.toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  };

  return (
    <div
      onMouseMove={resetIdle}
      className={`relative w-screen h-screen bg-black overflow-hidden flex items-center justify-center select-none ${
        isIdle ? 'cursor-none' : ''
      }`}
    >
      <video
        ref={videoRef}
        playsInline
        crossOrigin="anonymous"
        onClick={togglePlay}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={() => {
          if (!videoRef.current) return;
          const cur = videoRef.current.currentTime;
          const dur = videoRef.current.duration || 0;
          setCurrentTime(cur);
          setDuration(dur);
          setProgress(dur ? (cur / dur) * 100 : 0);
        }}
        className="w-full h-full object-contain cursor-pointer"
      />

      {/* Floating Status Notification */}
      <div className="absolute top-3 left-3 z-30 pointer-events-none flex items-center gap-2">
        <span className="px-2 py-0.5 rounded bg-indigo-600 text-[10px] font-bold uppercase tracking-wider text-white">
          Next.js Stream
        </span>
        <span className="px-2 py-0.5 rounded-full bg-slate-900/80 backdrop-blur border border-slate-700 text-xs text-slate-300">
          {status}
        </span>
      </div>

      {/* Overlay Controls */}
      <div
        className={`absolute inset-0 flex flex-col justify-end p-4 pointer-events-none transition-opacity duration-300 bg-gradient-to-t from-black/80 via-transparent to-transparent ${
          isIdle ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <div className="space-y-2 pointer-events-auto">
          {/* Progress Bar */}
          <div className="flex items-center space-x-3 text-[11px] font-mono text-slate-300">
            <span>{formatTime(currentTime)}</span>
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={progress}
              onChange={(e) => {
                if (!videoRef.current || !duration) return;
                videoRef.current.currentTime = (parseFloat(e.target.value) / 100) * duration;
              }}
              className="w-full h-1 bg-white/20 rounded cursor-pointer accent-indigo-500 hover:h-1.5 transition"
            />
            <span>{formatTime(duration)}</span>
          </div>

          {/* Controls Bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <button onClick={togglePlay} className="p-2 rounded-lg hover:bg-white/10 text-white transition">
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
              </button>
              <button onClick={toggleMute} className="p-2 rounded-lg hover:bg-white/10 text-white transition">
                {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <button
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime -= 10;
                }}
                className="p-2 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime += 10;
                }}
                className="p-2 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition"
              >
                <RotateCw className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center space-x-2 text-xs relative">
              {/* Server Switcher */}
              <button
                onClick={() => {
                  setShowServers(!showServers);
                  setShowSubtitles(false);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 transition flex items-center gap-1.5"
              >
                <Server className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden sm:inline">Servers ({sources.length})</span>
              </button>

              {showServers && (
                <div className="absolute bottom-10 right-12 w-48 bg-slate-900 border border-slate-700 rounded-xl p-2 shadow-2xl space-y-1 max-h-48 overflow-y-auto">
                  {sources.map((src, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        playStream(sources, i);
                        setShowServers(false);
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs transition flex justify-between ${
                        i === currentIdx ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <span className="truncate">{src.label || src.source}</span>
                      <span className="font-mono text-[10px] opacity-75">{src.quality}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Subtitles Button */}
              <button
                onClick={() => {
                  setShowSubtitles(!showSubtitles);
                  setShowServers(false);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 transition flex items-center gap-1.5"
              >
                <Subtitles className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden sm:inline">CC</span>
              </button>

              {showSubtitles && (
                <div className="absolute bottom-10 right-6 w-48 bg-slate-900 border border-slate-700 rounded-xl p-2 shadow-2xl space-y-1 max-h-48 overflow-y-auto">
                  <button
                    onClick={() => {
                      setActiveSubtitle('off');
                      setShowSubtitles(false);
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs ${
                      activeSubtitle === 'off' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    Off
                  </button>
                  {subtitles.map((sub, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setActiveSubtitle(String(i));
                        setShowSubtitles(false);
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs truncate ${
                        activeSubtitle === String(i) ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {sub.label || `Track ${i + 1}`}
                    </button>
                  ))}
                </div>
              )}

              {/* Fullscreen */}
              <button onClick={toggleFullscreen} className="p-2 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition">
                <Maximize className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EmbedPage() {
  return (
    <Suspense fallback={<div className="w-screen h-screen bg-black flex items-center justify-center text-slate-400 text-sm">Loading Embed Player...</div>}>
      <EmbedContent />
    </Suspense>
  );
}
