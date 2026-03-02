import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import * as QRCode from 'qrcode';

export async function sessionRoutes(fastify: FastifyInstance): Promise<void> {
  const { prisma, sessionManager } = fastify.appContext;

  // All routes require authentication
  fastify.addHook('preHandler', authenticate);

  // GET /api/sessions
  fastify.get('/', async () => {
    const sessions = await sessionManager.listSessions();
    return { sessions };
  });

  // POST /api/sessions
  // If phoneNumber is provided, uses pairing code instead of QR
  fastify.post<{
    Body: { name: string; phoneNumber?: string };
  }>('/', async (request) => {
    const { name, phoneNumber } = request.body;
    const sessionId = await sessionManager.createSession(name);
    const conn = await sessionManager.startSession(sessionId, phoneNumber);

    // Wait for QR code, pairing code, or connection (up to 30s)
    const result = await new Promise<{ qr?: string; pairingCode?: string }>((resolve) => {
      const timeout = setTimeout(() => resolve({}), 30_000);

      conn.on('connection', (event) => {
        if (event.type === 'qr') {
          clearTimeout(timeout);
          resolve({ qr: event.qr });
        } else if (event.type === 'pairing_code') {
          clearTimeout(timeout);
          resolve({ pairingCode: event.code });
        } else if (event.type === 'connected') {
          clearTimeout(timeout);
          resolve({});
        }
      });
    });

    let qrDataUrl: string | null = null;
    if (result.qr) {
      qrDataUrl = await QRCode.toDataURL(result.qr);
    }

    return {
      sessionId,
      qr: qrDataUrl,
      pairingCode: result.pairingCode || null,
    };
  });

  // GET /api/sessions/:id
  fastify.get<{
    Params: { id: string };
  }>('/:id', async (request, reply) => {
    const session = await prisma.session.findUnique({
      where: { id: request.params.id },
      include: { _count: { select: { targets: true } } },
    });

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    return { session };
  });

  // GET /api/sessions/:id/qr — Get current QR code
  fastify.get<{
    Params: { id: string };
  }>('/:id/qr', async (request, reply) => {
    const conn = sessionManager.getConnection(request.params.id);
    if (!conn) {
      return reply.status(404).send({ error: 'Session not found or not started' });
    }

    // Wait for next QR code
    const qr = await new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 30_000);

      conn.on('connection', (event) => {
        if (event.type === 'qr') {
          clearTimeout(timeout);
          resolve(event.qr);
        }
      });

      if (conn.isConnected) {
        clearTimeout(timeout);
        resolve(null);
      }
    });

    if (!qr) {
      return { qr: null, connected: conn.isConnected };
    }

    const qrDataUrl = await QRCode.toDataURL(qr);
    return { qr: qrDataUrl, connected: false };
  });

  // POST /api/sessions/:id/pairing-code — Request a pairing code for an existing session
  fastify.post<{
    Params: { id: string };
    Body: { phoneNumber: string };
  }>('/:id/pairing-code', async (request, reply) => {
    const { phoneNumber } = request.body;
    if (!phoneNumber) {
      return reply.status(400).send({ error: 'phoneNumber is required' });
    }

    // Stop existing connection and restart with pairing code
    await sessionManager.stopSession(request.params.id);
    const conn = await sessionManager.startSession(request.params.id, phoneNumber);

    // Wait for pairing code
    const code = await new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 30_000);

      conn.on('connection', (event) => {
        if (event.type === 'pairing_code') {
          clearTimeout(timeout);
          resolve(event.code);
        } else if (event.type === 'connected') {
          clearTimeout(timeout);
          resolve(null);
        }
      });
    });

    if (!code) {
      return { pairingCode: null, connected: conn.isConnected };
    }

    return { pairingCode: code };
  });

  // POST /api/sessions/:id/start
  fastify.post<{
    Params: { id: string };
  }>('/:id/start', async (request, reply) => {
    try {
      await sessionManager.startSession(request.params.id);
      return { status: 'started' };
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to start session' });
    }
  });

  // POST /api/sessions/:id/stop
  fastify.post<{
    Params: { id: string };
  }>('/:id/stop', async (request) => {
    await sessionManager.stopSession(request.params.id);
    return { status: 'stopped' };
  });

  // DELETE /api/sessions/:id
  fastify.delete<{
    Params: { id: string };
  }>('/:id', async (request) => {
    await sessionManager.deleteSession(request.params.id);
    return { status: 'deleted' };
  });
}
