import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  console.log('===== REQUEST HIT =====');
  console.log('METHOD:', req.method);
  console.log('URL:', req.url);
  console.log('ORIGIN:', req.headers.origin);

  res.setHeader(
    'Access-Control-Allow-Origin',
    'https://projectflow-web-eta.vercel.app',
  );
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Accept',
  );
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    console.log('===== OPTIONS HIT =====');
    return res.status(204).end();
  }

  return res.status(200).json({
    message: 'Backend function is working',
    method: req.method,
    url: req.url,
  });
}