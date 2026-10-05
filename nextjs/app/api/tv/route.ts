import { NextRequest } from 'next/server';
import { sdk } from '@/lib/sdk';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const season = parseInt(searchParams.get('season') || searchParams.get('s') || '1');
  const episode = parseInt(searchParams.get('episode') || searchParams.get('e') || '1');

  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing TMDB ID parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let isClosed = false;
      const safeWrite = (data: string) => {
        if (!isClosed) {
          try {
            controller.enqueue(encoder.encode(data));
          } catch {
            isClosed = true;
          }
        }
      };

      try {
        const [metaData, subtitlesData] = await Promise.allSettled([
          fetch(`https://api.themoviedb.org/3/tv/${id}?api_key=${process.env.TMDB_API_KEY}`).then(r => r.json()),
          sdk.getSubtitles(id, season, episode),
        ]);

        const title = metaData.status === 'fulfilled' ? `${metaData.value.name} (S${season}E${episode})` : `TV Show #${id}`;
        const subtitles = subtitlesData.status === 'fulfilled' ? subtitlesData.value : [];

        safeWrite(`data: ${JSON.stringify({
          type: 'meta',
          meta: { id, title },
          subtitles,
        })}\n\n`);

        const activeSources = sdk.getSources(true);
        let foundCount = 0;

        const promises = activeSources.map(async (src) => {
          try {
            const result: any = await Promise.race([
              sdk.getStream(src.key, id, season, episode, clientIP),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), src.timeout || 12000)),
            ]);

            if (result && !isClosed) {
              const streams = result.allUrls || (result.url ? [result] : []);
              for (const s of streams) {
                foundCount++;
                safeWrite(`data: ${JSON.stringify({
                  type: 'source',
                  source: {
                    source: src.key,
                    label: s.server || src.label,
                    url: s.url,
                    quality: s.quality || 'Auto',
                    type: s.type || 'hls',
                  },
                })}\n\n`);
              }
            }
          } catch {
            // Ignore failed provider
          }
        });

        await Promise.allSettled(promises);

        safeWrite(`data: ${JSON.stringify({
          type: 'done',
          total: foundCount,
        })}\n\n`);
      } catch (err: any) {
        safeWrite(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      } finally {
        isClosed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    },
  });
}
