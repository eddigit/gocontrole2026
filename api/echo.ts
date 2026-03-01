import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Try reading body in multiple ways
  let bodyViaGetter: unknown = 'not_read';
  let bodyGetterError: string | null = null;
  try {
    bodyViaGetter = req.body;
  } catch (e: any) {
    bodyGetterError = e.message;
  }

  let bodyViaStream = '';
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    bodyViaStream = Buffer.concat(chunks).toString('utf-8');
  } catch (e: any) {
    bodyViaStream = `stream_error: ${e.message}`;
  }

  return res.status(200).json({
    method: req.method,
    headers: {
      'content-type': req.headers['content-type'],
      'content-length': req.headers['content-length'],
      'transfer-encoding': req.headers['transfer-encoding'],
    },
    bodyViaGetter,
    bodyGetterError,
    bodyGetterType: typeof bodyViaGetter,
    bodyViaStream,
    bodyStreamLength: bodyViaStream.length,
  });
}
