import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const results: Record<string, unknown> = {};

  // Test the shared module import
  try {
    const shared = await import('./_lib/shared.js');
    results.sharedImport = 'ok';
    results.sharedExports = Object.keys(shared);

    // Test ensureDatabase
    try {
      await shared.ensureDatabase();
      results.ensureDatabase = 'ok';
    } catch (e: any) {
      results.ensureDatabase = { error: e.message, stack: e.stack?.slice(0, 500) };
    }

    // Test ensureAdmin
    try {
      await shared.ensureAdmin();
      results.ensureAdmin = 'ok';
    } catch (e: any) {
      results.ensureAdmin = { error: e.message, stack: e.stack?.slice(0, 500) };
    }

    // Test findUnique
    const email = process.env.ADMIN_EMAIL || 'admin@gocontrole.local';
    try {
      const user = await shared.prisma.user.findUnique({ where: { email } });
      results.findUser = user ? { found: true, id: user.id, email: user.email, role: user.role, passwordLength: user.password?.length } : { found: false };
    } catch (e: any) {
      results.findUser = { error: e.message };
    }

    // Test verifyPassword
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    try {
      const user = await shared.prisma.user.findUnique({ where: { email } });
      if (user) {
        const valid = await shared.verifyPassword(password, user.password);
        results.verifyPassword = { valid };
      } else {
        results.verifyPassword = { error: 'no user found' };
      }
    } catch (e: any) {
      results.verifyPassword = { error: e.message };
    }

    // Test signToken
    try {
      const token = shared.signToken({ userId: 'test', email: 'test@test.com', role: 'ADMIN' });
      results.signToken = { ok: true, tokenLength: token.length };
    } catch (e: any) {
      results.signToken = { error: e.message, stack: e.stack?.slice(0, 500) };
    }
  } catch (e: any) {
    results.sharedImport = { error: e.message, stack: e.stack?.slice(0, 500) };
  }

  return res.status(200).json(results);
}
