import VylaSDK from '@vyla-entertainment/sdk';

const globalForSDK = global as unknown as { vylaSDK?: VylaSDK };

export const sdk =
  globalForSDK.vylaSDK ||
  new VylaSDK({
    tmdbApiKey: process.env.TMDB_API_KEY,
  });

if (process.env.NODE_ENV !== 'production') globalForSDK.vylaSDK = sdk;
