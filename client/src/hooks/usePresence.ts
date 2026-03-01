import { useState, useEffect, useCallback } from 'react';
import { getSocket } from '../api/client';

interface ConfidenceScore {
  jid: string;
  status: string;
  confidence: number;
  signals: unknown[];
  reasoning: string;
  timestamp: string;
}

export function usePresenceUpdates() {
  const [scores, setScores] = useState<Map<string, ConfidenceScore>>(new Map());

  useEffect(() => {
    const socket = getSocket();

    const handleUpdate = (score: ConfidenceScore) => {
      setScores(prev => {
        const next = new Map(prev);
        next.set(score.jid, score);
        return next;
      });
    };

    socket.on('dashboard:update', handleUpdate);
    socket.on('presence:update', handleUpdate);

    return () => {
      socket.off('dashboard:update', handleUpdate);
      socket.off('presence:update', handleUpdate);
    };
  }, []);

  const subscribeToTargets = useCallback((jids: string[]) => {
    const socket = getSocket();
    socket.emit('target:subscribe', { jids });
  }, []);

  return { scores, subscribeToTargets };
}
