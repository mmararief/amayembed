'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import { Server, Sparkles, X, ChevronDown, Film } from 'lucide-react';

function VideoJsEmbedContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id') || '155';
  const type = searchParams.get('type') || 'movie';
  const season = searchParams.get('season') || searchParams.get('s') || '1';
  const episode = searchParams.get('episode') || searchParams.get('e') || '1';
  const autoplay = searchParams.get('autoplay') !== '0';

  const videoContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const [sources, setSources] = useState<any[]>([]);
  const [currentIdx, setCurrentIdx] = useState<number>(-1);
  const [mediaTitle, setMediaTitle] = useState<string>(`Loading ${type.toUpperCase()} #${id}...`);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [statusTitle, setStatusTitle] = useState<string>('Searching Best Stream');
  const [statusSubtitle, setStatusSubtitle] = useState<string>('Connecting Video.js to SSE pipeline...');
  const [isServerModalOpen, setIsServerModalOpen] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3200);
  };

  // 1. Initialize Video.js Player
  useEffect(() => {
    if (!videoContainerRef.current) return;

    const videoElement = document.createElement('video-js');
    videoElement.classList.add('vjs-default-skin', 'vjs-big-play-centered', 'w-full', 'h-full');
    videoContainerRef.current.appendChild(videoElement);

    const player = (playerRef.current = videojs(videoElement, {
      controls: true,
      autoplay: autoplay,
      preload: 'auto',
      fluid: true,
      playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
      controlBar: {
        children: [
          'playToggle',
          'volumePanel',
          'currentTimeDisplay',
          'timeDivider',
          'durationDisplay',
          'progressControl',
          'playbackRateMenuButton',
          'subsCapsButton',
          'pictureInPictureToggle',
          'fullscreenToggle',
        ],
      },
    }));

    // Auto-fallback on playback error
    player.on('error', () => {
      console.warn('Video.js error encountered:', player.error());
      player.error(null);
      triggerFallback();
    });

    return () => {
      if (player && !player.isDisposed()) {
        player.dispose();
        playerRef.current = null;
      }
    };
  }, []);

  // 2. SSE Discovery Pipeline
  useEffect(() => {
    if (!id) return;

    setCurrentIdx(-1);
    setSources([]);
    setIsLoading(true);
    setStatusTitle('Searching Best Stream');
    setStatusSubtitle('Connecting to Next.js Route Handlers...');

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
          if (Array.isArray(data.subtitles) && playerRef.current) {
            data.subtitles.forEach((sub: any, i: number) => {
              playerRef.current.addRemoteTextTrack(
                {
                  kind: 'subtitles',
                  label: sub.label || `Track ${i + 1}`,
                  srclang: (sub.label || 'en').toLowerCase().slice(0, 2),
                  src: sub.file,
                },
                false
              );
            });
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
      } catch (err) {
        console.error('SSE Error:', err);
      }
    };

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
    };
  }, [id, type, season, episode]);

  const playStream = (list: any[], index: number) => {
    const src = list[index];
    if (!src || !playerRef.current) return;

    setCurrentIdx(index);
    setIsLoading(false);
    triggerToast(`Connected: ${src.label || src.source}`);

    const streamUrl = src.url;
    const isHls = streamUrl.includes('.m3u8') || src.type === 'hls' || streamUrl.includes('api?url=');
    const mimeType = isHls ? 'application/x-mpegURL' : 'video/mp4';

    playerRef.current.src({
      src: streamUrl,
      type: mimeType,
    });

    playerRef.current.ready(() => {
      if (autoplay) {
        playerRef.current.play().catch(() => {});
      }
    });
  };

  const triggerFallback = () => {
    setSources((prev) => {
      if (currentIdx + 1 < prev.length) {
        triggerToast(`Server failed. Trying backup #${currentIdx + 2}...`);
        playStream(prev, currentIdx + 1);
      } else {
        setIsLoading(true);
        setStatusTitle('Playback Failed');
        setStatusSubtitle('All candidate servers exhausted.');
      }
      return prev;
    });
  };

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden flex items-center justify-center select-none">
      {/* Video.js Container */}
      <div ref={videoContainerRef} className="w-full h-full object-contain" />

      {/* Top Overlay: Title & Active Server */}
      <div className="absolute top-0 left-0 right-0 p-4 sm:p-5 flex items-center justify-between z-20 pointer-events-none bg-gradient-to-b from-black/80 via-black/30 to-transparent">
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

        <div className="flex items-center space-x-2 pointer-events-auto">
          <button
            onClick={() => setIsServerModalOpen(!isServerModalOpen)}
            className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-slate-900/80 backdrop-blur border border-white/10 hover:bg-white/10 text-xs transition"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-medium text-slate-200">
              {sources[currentIdx]?.label || sources[currentIdx]?.source || 'Auto Server'}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>
      </div>

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
          <div className="px-4 py-2 rounded-xl bg-slate-900/90 backdrop-blur-md text-xs text-white shadow-2xl flex items-center gap-2.5 border border-white/10">
            <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="font-medium">{toastMsg}</span>
          </div>
        </div>
      )}

      {/* Server Selector Modal */}
      {isServerModalOpen && (
        <div className="absolute bottom-20 right-4 sm:right-8 w-72 bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl z-40">
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">Video.js Servers</span>
            </div>
            <button onClick={() => setIsServerModalOpen(false)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {sources.map((src, i) => (
              <button
                key={i}
                onClick={() => {
                  playStream(sources, i);
                  setIsServerModalOpen(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs transition flex items-center justify-between ${
                  i === currentIdx ? 'bg-indigo-600 text-white font-semibold shadow-md' : 'text-slate-300 hover:bg-white/10'
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
    </div>
  );
}

export default function EmbedPage() {
  return (
    <Suspense
      fallback={
        <div className="w-screen h-screen bg-black flex items-center justify-center text-slate-400 text-sm">
          Loading Video.js Player...
        </div>
      }
    >
      <VideoJsEmbedContent />
    </Suspense>
  );
}
