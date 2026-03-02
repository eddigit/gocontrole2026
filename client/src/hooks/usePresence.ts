import { useState, useEffect, useCallback, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { dashboardApi } from '../api/client';

interface ConfidenceScore {
  jid: string;
  status: string;
  confidence: number;
  timestamp: string;
}

/**
 * Real-time presence updates via Socket.IO with polling fallback.
 *
 * 1. Connects to Socket.IO for instant score updates
 * 2. Falls back to 30s polling if WebSocket connection fails
 * 3. Initial load always via HTTP (immediate data)
 */
export function usePresenceUpdates() {
  const [scores, setScores] = useState<Map<string, ConfidenceScore>>(new Map());
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const subscribedJidsRef = useRef<string[]>([]);

  // Initial HTTP fetch (fast first load)
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
      // Silent fail
    }
  }, []);

  // Socket.IO connection
  useEffect(() => {
    const socket = io({
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      // Re-subscribe to previously subscribed targets
      if (subscribedJidsRef.current.length > 0) {
        socket.emit('target:subscribe', { jids: subscribedJidsRef.current });
      }
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    // Real-time presence score updates
    socket.on('presence:update', (score: ConfidenceScore) => {
      setScores(prev => {
        const next = new Map(prev);
        next.set(score.jid, score);
        return next;
      });
    });

    // Dashboard-level updates (broadcast to all)
    socket.on('dashboard:update', (score: ConfidenceScore) => {
      setScores(prev => {
        const next = new Map(prev);
        next.set(score.jid, score);
        return next;
      });
    });

    // Initial data via HTTP
    fetchUpdates();

    // Fallback polling only when Socket.IO is disconnected
    const fallbackInterval = setInterval(() => {
      if (!socketRef.current?.connected) {
        fetchUpdates();
      }
    }, 30_000);

    return () => {
      clearInterval(fallbackInterval);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [fetchUpdates]);

  const subscribeToTargets = useCallback((jids: string[]) => {
    subscribedJidsRef.current = jids;
    if (socketRef.current?.connected) {
      socketRef.current.emit('target:subscribe', { jids });
    }
  }, []);

  return { scores, subscribeToTargets, connected };
}

/**
 * Hook for real-time message events on a specific target.
 */
export function useTargetEvents(targetJid: string | undefined) {
  const [messages, setMessages] = useState<any[]>([]);
  const [calls, setCalls] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);

  useEffect(() => {
    if (!targetJid) return;

    const socket = io({
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      socket.emit('target:subscribe', { jids: [targetJid] });
    });

    socket.on('message:new', (event: any) => {
      setMessages(prev => [event, ...prev].slice(0, 100));
    });

    socket.on('message:deleted', (event: any) => {
      setMessages(prev => prev.map(m =>
        m.waMessageId === event.waMessageId ? { ...m, isDeleted: true } : m
      ));
    });

    socket.on('call:event', (event: any) => {
      setCalls(prev => [event, ...prev].slice(0, 50));
    });

    socket.on('group:activity', (event: any) => {
      setGroups(prev => [event, ...prev].slice(0, 50));
    });

    return () => {
      socket.emit('target:unsubscribe', { jids: [targetJid] });
      socket.disconnect();
    };
  }, [targetJid]);

  return { messages, calls, groups };
}
