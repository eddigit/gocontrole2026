import { useState, useEffect, useCallback } from 'react';
import { dashboardApi } from '../api/client';

interface ConfidenceScore {
  jid: string;
  status: string;
  confidence: number;
  timestamp: string;
}

/**
 * Polling-based presence updates (Vercel serverless compatible).
 * Polls the dashboard summary every 10 seconds.
 */
export function usePresenceUpdates() {
  const [scores, setScores] = useState<Map<string, ConfidenceScore>>(new Map());

  const fetchUpdates = useCallback(async () => {
    try {
      const res = await dashboardApi.summary();
      const targets = res.data.targets || [];
      const next = new Map<string, ConfidenceScore>();
      for (const t of targets) {
        next.set(t.jid, {
          jid: t.jid,
          status: t.status,
          confidence: t.confidence,
          timestamp: t.updatedAt,
        });
      }
      setScores(next);
    } catch {
      // Silent fail — will retry on next poll
    }
  }, []);

  useEffect(() => {
    fetchUpdates();
    const interval = setInterval(fetchUpdates, 10_000);
    return () => clearInterval(interval);
  }, [fetchUpdates]);

  const subscribeToTargets = useCallback((_jids: string[]) => {
    // No-op in polling mode — all targets are fetched via summary
  }, []);

  return { scores, subscribeToTargets };
}
