import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma, authenticate, cors } from '../_lib/shared.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = authenticate(req);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const alerts = await prisma.alertRule.findMany({
        where: { userId: auth.userId },
        orderBy: { createdAt: 'desc' },
        include: {
          target: { select: { jid: true, phoneNumber: true, label: true } },
        },
      });
      return res.status(200).json({ alerts });
    }

    if (req.method === 'POST') {
      const { targetId, triggerOn, channel, destination, cooldownMin } = req.body || {};

      if (!targetId || !triggerOn) {
        return res.status(400).json({ error: 'targetId and triggerOn are required' });
      }

      const target = await prisma.target.findUnique({ where: { id: targetId } });
      if (!target) {
        return res.status(404).json({ error: 'Target not found' });
      }

      const alert = await prisma.alertRule.create({
        data: {
          userId: auth.userId,
          targetId,
          triggerOn: triggerOn as any,
          channel: channel || 'WEBSOCKET',
          destination: destination || '',
          cooldownMin: cooldownMin || 5,
        },
      });

      return res.status(201).json({ alert });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Alerts error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
