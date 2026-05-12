import { createHash } from 'crypto';

export const buildHeaders = (apiKey, secretKey, timestamp) => {
  const ts = String(timestamp ?? Math.floor(Date.now() / 1000));
  const sig = createHash('sha256')
    .update(apiKey + secretKey + ts).digest('hex');
  return {
    'Api-Key': apiKey,
    'X-Api-Key': apiKey,
    'X-Signature': sig,
    'X-Timestamp': ts,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
};
