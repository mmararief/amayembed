'use client';

import { useState, useRef, useEffect } from 'react';
import Hls from 'hls.js';
import { Play, Film, Tv, Search, Radio, Copy, Check, Info } from 'lucide-react';

export default function HomePage() {
  const [mediaType, setMediaType] = useState<'movie' | 'tv'>('movie');
  const [query, setQuery] = useState('155');
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [sources, setSources] = useState<any[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const [status, setStatus] = useState<string>('Ready');
  const [title, setTitle] = useState<string>('The Dark Knight');
  const [copied, setCopied] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const startStream = () => {
    if (!query) return;

    if (eventSourceRef.current) eventSourceRef.current.close();
    if (hlsRef.current) hlsRef.current.destroy();

    setSources([]);
    setActiveIdx(-1);
    setStatus('Searching candidates via Next.js Route Handler...');

    const sseUrl = mediaType === 'tv'
      ? `/api/tv?id=${encodeURIComponent(query)}&season=${season}&episode=${episode}`
      : `/api/movie?id=${encodeURIComponent(query)}`;

    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'meta') {
          if (data.meta?.title) setTitle(data.meta.title);
        }

        if (data.type === 'source') {
          setSources((prev) => {
            const next = [...prev, data.source];
            if (activeIdx === -1 && next.length === 1) {
              playSource(next, 0);
            }
            return next;
          });
        }

        if (data.type === 'done') {
          setStatus(`Discovery finished (${data.total || 0} sources found)`);
          es.close();
        }
      } catch (err) {
        console.error('SSE Parse Error:', err);
      }
    };

    es.onerror = () => {
      setStatus('SSE stream disconnected.');
      es.close();
    };
  };

  const playSource = (list: any[], idx: number) => {
    const src = list[idx];
    if (!src || !videoRef.current) return;

    setActiveIdx(idx);
    setStatus(`Playing: ${src.label || src.source}`);

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
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          if (idx + 1 < list.length) {
            playSource(list, idx + 1);
          }
        }
      });
    } else {
      video.src = src.url;
      video.play().catch(() => {});
      video.onerror = () => {
        if (idx + 1 < list.length) {
          playSource(list, idx + 1);
        }
      };
    }
  };

  const copyEmbedCode = () => {
    const embedUrl = `${window.location.origin}/embed?type=${mediaType}&id=${query}${
      mediaType === 'tv' ? `&s=${season}&e=${episode}` : ''
    }`;
    const iframeCode = `<iframe src="${embedUrl}" width="100%" height="500px" frameborder="0" allowfullscreen allow="autoplay; encrypted-media"></iframe>`;
    navigator.clipboard.writeText(iframeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-white via-indigo-200 to-indigo-400 bg-clip-text text-transparent">
            Stream API — Next.js Edition
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Scraper + Player berjalan menyatu dalam 1 aplikasi Next.js (App Router)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
            Route Handlers Active
          </span>
        </div>
      </div>

      {/* Control Panel */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Movie / TV Toggle */}
          <div className="flex p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setMediaType('movie')}
              className={`px-4 py-2 rounded-lg font-medium transition flex items-center gap-1.5 ${
                mediaType === 'movie' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Film className="w-4 h-4" /> Movie
            </button>
            <button
              onClick={() => setMediaType('tv')}
              className={`px-4 py-2 rounded-lg font-medium transition flex items-center gap-1.5 ${
                mediaType === 'tv' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Tv className="w-4 h-4" /> TV Show
            </button>
          </div>

          {/* Quick Presets */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">Presets:</span>
            <button
              onClick={() => {
                setMediaType('movie');
                setQuery('155');
              }}
              className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              The Dark Knight
            </button>
            <button
              onClick={() => {
                setMediaType('movie');
                setQuery('550');
              }}
              className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              Fight Club
            </button>
            <button
              onClick={() => {
                setMediaType('tv');
                setQuery('1396');
                setSeason(1);
                setEpisode(1);
              }}
              className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              Breaking Bad S1E1
            </button>
          </div>
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-6">
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">
              TMDB ID
            </label>
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. 155"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 pl-10"
              />
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            </div>
          </div>

          {mediaType === 'tv' && (
            <>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">
                  Season
                </label>
                <input
                  type="number"
                  min="1"
                  value={season}
                  onChange={(e) => setSeason(parseInt(e.target.value) || 1)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">
                  Episode
                </label>
                <input
                  type="number"
                  min="1"
                  value={episode}
                  onChange={(e) => setEpisode(parseInt(e.target.value) || 1)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </>
          )}

          <div className={`${mediaType === 'tv' ? 'md:col-span-2' : 'md:col-span-6'}`}>
            <button
              onClick={startStream}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm rounded-xl shadow-lg shadow-indigo-600/25 transition flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Stream in Next.js</span>
            </button>
          </div>
        </div>
      </div>

      {/* Grid: Video + Candidate Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Player */}
        <div className="lg:col-span-8 space-y-4">
          <div className="relative bg-black rounded-2xl overflow-hidden border border-slate-800 aspect-video shadow-2xl flex items-center justify-center">
            <video ref={videoRef} controls className="w-full h-full object-contain" />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-white text-base">{title}</h2>
              <p className="text-xs text-slate-400">
                TMDB ID: {query} {mediaType === 'tv' && `(S${season}E${episode})`} • Status: {status}
              </p>
            </div>
            <button
              onClick={copyEmbedCode}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition flex items-center gap-1.5 border border-slate-700"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Iframe Copied!' : 'Copy Embed Iframe'}</span>
            </button>
          </div>
        </div>

        {/* Right: Sources */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 h-[480px] flex flex-col shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <Radio className="w-4 h-4 text-indigo-400 animate-pulse" />
              <span>Discovered Sources</span>
            </div>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
              {sources.length} found
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {sources.length === 0 ? (
              <div className="text-center py-16 text-slate-500 text-xs">
                Klik &quot;Stream in Next.js&quot; untuk menjalankan scraper Route Handler.
              </div>
            ) : (
              sources.map((src, i) => (
                <div
                  key={i}
                  onClick={() => playSource(sources, i)}
                  className={`p-3 rounded-xl border text-xs cursor-pointer transition flex items-center justify-between ${
                    i === activeIdx
                      ? 'bg-indigo-600/20 border-indigo-500 text-white font-medium'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="truncate">
                    <div className="truncate font-semibold">{src.label || src.source}</div>
                    <div className="text-[10px] text-slate-500 uppercase">{src.source} • {src.type}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-slate-800 font-mono text-[10px] text-slate-300">
                      {src.quality}
                    </span>
                    {i === activeIdx && (
                      <span className="text-[10px] font-bold text-indigo-400">PLAYING</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
