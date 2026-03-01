import type { FastifyInstance } from 'fastify';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  const { prisma, sessionManager } = fastify.appContext;

  // GET /api/health — No auth required
  fastify.get('/', async () => {
    let dbStatus = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }

    const sessions = await sessionManager.listSessions();
    const connectedSessions = sessions.filter(s => s.status === 'CONNECTED').length;

    return {
      status: dbStatus === 'ok' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      database: dbStatus,
      sessions: {
        total: sessions.length,
        connected: connectedSessions,
      },
    };
  });
}
