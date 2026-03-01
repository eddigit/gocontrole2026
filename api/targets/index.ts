import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma, authenticate, cors, phoneToJid, formatPhone } from '../_lib/shared.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = authenticate(req);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const targets = await prisma.target.findMany({
        orderBy: { createdAt: 'asc' },
        include: {
          session: { select: { id: true, name: true, status: true } },
        },
      });
      return res.status(200).json({ targets });
    }

    if (req.method === 'POST') {
      const { phoneNumber, label, sessionId } = req.body || {};

      if (!phoneNumber) {
        return res.status(400).json({ error: 'phoneNumber is required' });
      }

      const jid = phoneToJid(phoneNumber);

      const existing = await prisma.target.findUnique({ where: { jid } });
      if (existing) {
        return res.status(409).json({ error: 'Phone number already monitored' });
      }

      // Find or create a default session
      let assignedSessionId = sessionId;
      if (!assignedSessionId) {
        let session = await prisma.session.findFirst({ orderBy: { createdAt: 'asc' } });
        if (!session) {
          session = await prisma.session.create({
            data: { name: 'Session par defaut', status: 'DISCONNECTED' },
          });
        }
        assignedSessionId = session.id;
      }

      const target = await prisma.target.create({
        data: {
          jid,
          phoneNumber: formatPhone(phoneNumber),
          label: label || null,
          sessionId: assignedSessionId,
        },
      });

      return res.status(201).json({ target });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Targets error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
