import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma, authenticate, cors, parseBody } from '../_lib/shared.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = authenticate(req);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const sessions = await prisma.session.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          status: true,
          lastConnected: true,
          lastError: true,
          createdAt: true,
          _count: { select: { targets: true } },
        },
      });
      return res.status(200).json({ sessions });
    }

    if (req.method === 'POST') {
      const { name } = parseBody(req) as any;

      if (!name) {
        return res.status(400).json({ error: 'name is required' });
      }

      const session = await prisma.session.create({
        data: { name, status: 'DISCONNECTED' },
      });

      return res.status(201).json({ session });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Sessions error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
