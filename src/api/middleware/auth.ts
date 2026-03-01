import type { FastifyRequest, FastifyReply } from 'fastify';

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: 'Unauthorized' });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await authenticate(request, reply);
  if (reply.sent) return;

  if (request.user.role !== 'ADMIN') {
    reply.status(403).send({ error: 'Admin access required' });
  }
}
