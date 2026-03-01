import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma, authenticate, cors, parseBody } from '../_lib/shared.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = authenticate(req);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing alert id' });
  }

  try {
    if (req.method === 'PATCH') {
      const { isActive } = await parseBody(req) as any;

      const alert = await prisma.alertRule.findFirst({
        where: { id, userId: auth.userId },
      });
      if (!alert) {
        return res.status(404).json({ error: 'Alert not found' });
      }

      const updated = await prisma.alertRule.update({
        where: { id },
        data: { isActive: isActive ?? alert.isActive },
      });

      return res.status(200).json({ alert: updated });
    }

    if (req.method === 'DELETE') {
      const alert = await prisma.alertRule.findFirst({
        where: { id, userId: auth.userId },
      });
      if (!alert) {
        return res.status(404).json({ error: 'Alert not found' });
      }

      await prisma.alertRule.delete({ where: { id } });

      return res.status(200).json({ status: 'deleted' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Alert detail error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
