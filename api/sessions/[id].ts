import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma, authenticate, cors } from '../_lib/shared.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = authenticate(req);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing session id' });
  }

  try {
    if (req.method === 'GET') {
      const session = await prisma.session.findUnique({
        where: { id },
        include: {
          targets: { select: { id: true, jid: true, phoneNumber: true, label: true, status: true, confidence: true } },
        },
      });

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      return res.status(200).json({ session });
    }

    if (req.method === 'DELETE') {
      const session = await prisma.session.findUnique({ where: { id } });
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Check no targets assigned
      const targetCount = await prisma.target.count({ where: { sessionId: id } });
      if (targetCount > 0) {
        return res.status(400).json({ error: 'Cannot delete session with assigned targets. Remove targets first.' });
      }

      await prisma.authKey.deleteMany({ where: { sessionId: id } });
      await prisma.session.delete({ where: { id } });

      return res.status(200).json({ status: 'deleted' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Session detail error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
