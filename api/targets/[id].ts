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
    return res.status(400).json({ error: 'Missing target id' });
  }

  try {
    if (req.method === 'GET') {
      const target = await prisma.target.findUnique({
        where: { id },
        include: { session: { select: { id: true, name: true, status: true } } },
      });

      if (!target) {
        return res.status(404).json({ error: 'Target not found' });
      }

      // Get recent snapshots for timeline
      const snapshots = await prisma.statusSnapshot.findMany({
        where: {
          targetId: id,
          timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        orderBy: { timestamp: 'asc' },
        select: { status: true, confidence: true, timestamp: true },
      });

      return res.status(200).json({ target, timeline: snapshots });
    }

    if (req.method === 'DELETE') {
      const target = await prisma.target.findUnique({ where: { id } });
      if (!target) {
        return res.status(404).json({ error: 'Target not found' });
      }

      // Delete related data first
      await prisma.presenceEvent.deleteMany({ where: { targetId: id } });
      await prisma.rttProbe.deleteMany({ where: { targetId: id } });
      await prisma.statusSnapshot.deleteMany({ where: { targetId: id } });
      await prisma.alertRule.deleteMany({ where: { targetId: id } });
      await prisma.target.delete({ where: { id } });

      return res.status(200).json({ status: 'deleted' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Target detail error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
