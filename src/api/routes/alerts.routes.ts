import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';

export async function alertRoutes(fastify: FastifyInstance): Promise<void> {
  const { prisma } = fastify.appContext;

  fastify.addHook('preHandler', authenticate);

  // GET /api/alerts
  fastify.get('/', async (request) => {
    const alerts = await prisma.alertRule.findMany({
      where: { userId: request.user.userId },
      include: {
        target: { select: { jid: true, phoneNumber: true, label: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { alerts };
  });

  // POST /api/alerts
  fastify.post<{
    Body: {
      targetId: string;
      triggerOn: string;
      channel?: string;
      destination?: string;
      cooldownMin?: number;
    };
  }>('/', async (request) => {
    const { targetId, triggerOn, channel, destination, cooldownMin } = request.body;

    const alert = await prisma.alertRule.create({
      data: {
        userId: request.user.userId,
        targetId,
        triggerOn: triggerOn as any,
        channel: (channel as any) || 'WEBSOCKET',
        destination: destination || '',
        cooldownMin: cooldownMin || 5,
      },
    });

    return { alert };
  });

  // PUT /api/alerts/:id
  fastify.put<{
    Params: { id: string };
    Body: { isActive?: boolean; triggerOn?: string; channel?: string; destination?: string; cooldownMin?: number };
  }>('/:id', async (request, reply) => {
    const alert = await prisma.alertRule.findFirst({
      where: { id: request.params.id, userId: request.user.userId },
    });

    if (!alert) {
      return reply.status(404).send({ error: 'Alert rule not found' });
    }

    const updated = await prisma.alertRule.update({
      where: { id: request.params.id },
      data: {
        isActive: request.body.isActive,
        triggerOn: request.body.triggerOn as any,
        channel: request.body.channel as any,
        destination: request.body.destination,
        cooldownMin: request.body.cooldownMin,
      },
    });

    return { alert: updated };
  });

  // DELETE /api/alerts/:id
  fastify.delete<{
    Params: { id: string };
  }>('/:id', async (request, reply) => {
    const alert = await prisma.alertRule.findFirst({
      where: { id: request.params.id, userId: request.user.userId },
    });

    if (!alert) {
      return reply.status(404).send({ error: 'Alert rule not found' });
    }

    await prisma.alertRule.delete({ where: { id: request.params.id } });
    return { status: 'deleted' };
  });
}
