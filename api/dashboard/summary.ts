import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma, authenticate, cors } from '../_lib/shared.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = authenticate(req);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const targets = await prisma.target.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      include: {
        session: { select: { id: true, name: true, status: true } },
      },
    });

    const counts = {
      total: targets.length,
      online: targets.filter(t => t.status === 'ONLINE').length,
      likelyOnline: targets.filter(t => t.status === 'LIKELY_ONLINE').length,
      uncertain: targets.filter(t => t.status === 'UNCERTAIN').length,
      likelyOffline: targets.filter(t => t.status === 'LIKELY_OFFLINE').length,
      offline: targets.filter(t => t.status === 'OFFLINE').length,
    };

    return res.status(200).json({ targets, counts });
  } catch (err) {
    console.error('Dashboard summary error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
