import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import type { ConnectionManager } from '../whatsapp/connection-manager.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('message-interceptor');

export interface InterceptedMessageEvent {
  targetJid: string;
  waMessageId: string;
  type: string;
  direction: 'INCOMING' | 'OUTGOING';
  senderJid: string;
  chatJid: string;
  content: string | null;
  timestamp: Date;
  isForwarded: boolean;
  isViewOnce: boolean;
  quotedMsgId: string | null;
  mentions: string[];
  // Media info
  mediaMimeType?: string;
  mediaFileName?: string;
  mediaFileSize?: number;
  mediaThumbnail?: string;
  mediaDuration?: number;
  mediaWidth?: number;
  mediaHeight?: number;
  // Location info
  latitude?: number;
  longitude?: number;
  locationName?: string;
  locationAddress?: string;
  // Raw
  raw: Record<string, unknown>;
}

/**
 * Message Interceptor
 *
 * Captures all incoming and outgoing WhatsApp messages,
 * classifies their type, and persists them to the database.
 */
export class MessageInterceptor extends EventEmitter {
  private monitoredJids = new Set<string>();

  constructor(
    private readonly connection: ConnectionManager,
    private readonly prisma: PrismaClient,
  ) {
    super();
  }

  async start(jids: string[]): Promise<void> {
    for (const jid of jids) {
      this.monitoredJids.add(jid);
    }

    // Listen for new messages
    this.connection.onBaileysEvent('messages.upsert', (upsert) => {
      const { messages, type } = upsert as { messages: any[]; type: string };
      if (type !== 'notify') return; // Only real-time messages

      for (const msg of messages) {
        this.handleMessage(msg).catch(err => {
          log.error({ err }, 'Error handling message');
        });
      }
    });

    // Listen for message deletions
    this.connection.onBaileysEvent('messages.delete', (deletion) => {
      this.handleDeletion(deletion as any).catch(err => {
        log.error({ err }, 'Error handling deletion');
      });
    });

    // Listen for message reactions
    this.connection.onBaileysEvent('messages.reaction', (reactions) => {
      for (const reaction of reactions as any[]) {
        this.handleReaction(reaction).catch(err => {
          log.error({ err }, 'Error handling reaction');
        });
      }
    });

    log.info({ count: jids.length }, 'Message interceptor started');
  }

  addJid(jid: string): void {
    this.monitoredJids.add(jid);
  }

  removeJid(jid: string): void {
    this.monitoredJids.delete(jid);
  }

  stop(): void {
    this.monitoredJids.clear();
    log.info('Message interceptor stopped');
  }

  private async handleMessage(msg: any): Promise<void> {
    const key = msg.key;
    if (!key) return;

    const chatJid = key.remoteJid;
    if (!chatJid) return;

    // Determine the relevant target JID (the contact, not us)
    const senderJid = key.fromMe
      ? (this.connection.socket?.user?.id ?? 'unknown')
      : (key.participant || chatJid);

    const targetJid = key.fromMe ? chatJid : senderJid;

    // Check if we monitor this contact (either as sender or receiver)
    const isMonitored = this.isRelevantJid(chatJid) || this.isRelevantJid(senderJid);
    if (!isMonitored) return;

    // Determine the actual monitored target
    const monitoredTarget = this.findMonitoredJid(chatJid, senderJid);
    if (!monitoredTarget) return;

    const messageContent = msg.message;
    if (!messageContent) return;

    // Classify the message type and extract content
    const parsed = this.parseMessage(messageContent);

    const event: InterceptedMessageEvent = {
      targetJid: monitoredTarget,
      waMessageId: key.id || `${Date.now()}`,
      type: parsed.type,
      direction: key.fromMe ? 'OUTGOING' : 'INCOMING',
      senderJid: this.normalizeJid(senderJid),
      chatJid: this.normalizeJid(chatJid),
      content: parsed.content,
      timestamp: new Date((msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000),
      isForwarded: parsed.isForwarded,
      isViewOnce: !!messageContent.viewOnceMessage || !!messageContent.viewOnceMessageV2,
      quotedMsgId: parsed.quotedMsgId,
      mentions: parsed.mentions,
      mediaMimeType: parsed.mediaMimeType,
      mediaFileName: parsed.mediaFileName,
      mediaFileSize: parsed.mediaFileSize,
      mediaThumbnail: parsed.mediaThumbnail,
      mediaDuration: parsed.mediaDuration,
      mediaWidth: parsed.mediaWidth,
      mediaHeight: parsed.mediaHeight,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      locationName: parsed.locationName,
      locationAddress: parsed.locationAddress,
      raw: { key, messageTimestamp: msg.messageTimestamp },
    };

    // Persist to database
    await this.persistMessage(event);

    // Emit for real-time broadcasting
    this.emit('message', event);

    log.debug({ targetJid: monitoredTarget, type: parsed.type, direction: event.direction }, 'Message intercepted');
  }

  private parseMessage(messageContent: any): {
    type: string;
    content: string | null;
    isForwarded: boolean;
    quotedMsgId: string | null;
    mentions: string[];
    mediaMimeType?: string;
    mediaFileName?: string;
    mediaFileSize?: number;
    mediaThumbnail?: string;
    mediaDuration?: number;
    mediaWidth?: number;
    mediaHeight?: number;
    latitude?: number;
    longitude?: number;
    locationName?: string;
    locationAddress?: string;
  } {
    // Handle viewOnce wrapper
    const inner = messageContent.viewOnceMessage?.message
      || messageContent.viewOnceMessageV2?.message
      || messageContent.ephemeralMessage?.message
      || messageContent;

    const contextInfo = this.extractContextInfo(inner);

    const base = {
      isForwarded: !!contextInfo?.isForwarded,
      quotedMsgId: contextInfo?.quotedMessage ? (contextInfo.stanzaId || null) : null,
      mentions: (contextInfo?.mentionedJid || []) as string[],
    };

    // Text message
    if (inner.conversation || inner.extendedTextMessage) {
      return {
        ...base,
        type: 'TEXT',
        content: inner.conversation || inner.extendedTextMessage?.text || null,
      };
    }

    // Image
    if (inner.imageMessage) {
      const img = inner.imageMessage;
      return {
        ...base,
        type: 'IMAGE',
        content: img.caption || null,
        mediaMimeType: img.mimetype || 'image/jpeg',
        mediaFileSize: img.fileLength ? Number(img.fileLength) : undefined,
        mediaThumbnail: img.jpegThumbnail ? Buffer.from(img.jpegThumbnail).toString('base64') : undefined,
        mediaWidth: img.width || undefined,
        mediaHeight: img.height || undefined,
      };
    }

    // Video
    if (inner.videoMessage) {
      const vid = inner.videoMessage;
      return {
        ...base,
        type: 'VIDEO',
        content: vid.caption || null,
        mediaMimeType: vid.mimetype || 'video/mp4',
        mediaFileSize: vid.fileLength ? Number(vid.fileLength) : undefined,
        mediaThumbnail: vid.jpegThumbnail ? Buffer.from(vid.jpegThumbnail).toString('base64') : undefined,
        mediaDuration: vid.seconds || undefined,
        mediaWidth: vid.width || undefined,
        mediaHeight: vid.height || undefined,
      };
    }

    // Audio / Voice note
    if (inner.audioMessage) {
      const audio = inner.audioMessage;
      return {
        ...base,
        type: audio.ptt ? 'VOICE_NOTE' : 'AUDIO',
        content: null,
        mediaMimeType: audio.mimetype || 'audio/ogg',
        mediaFileSize: audio.fileLength ? Number(audio.fileLength) : undefined,
        mediaDuration: audio.seconds || undefined,
      };
    }

    // Document
    if (inner.documentMessage) {
      const doc = inner.documentMessage;
      return {
        ...base,
        type: 'DOCUMENT',
        content: doc.caption || doc.title || null,
        mediaMimeType: doc.mimetype || 'application/octet-stream',
        mediaFileName: doc.fileName || undefined,
        mediaFileSize: doc.fileLength ? Number(doc.fileLength) : undefined,
        mediaThumbnail: doc.jpegThumbnail ? Buffer.from(doc.jpegThumbnail).toString('base64') : undefined,
      };
    }

    // Sticker
    if (inner.stickerMessage) {
      const sticker = inner.stickerMessage;
      return {
        ...base,
        type: 'STICKER',
        content: null,
        mediaMimeType: sticker.mimetype || 'image/webp',
        mediaFileSize: sticker.fileLength ? Number(sticker.fileLength) : undefined,
        mediaWidth: sticker.width || undefined,
        mediaHeight: sticker.height || undefined,
      };
    }

    // Location
    if (inner.locationMessage) {
      const loc = inner.locationMessage;
      return {
        ...base,
        type: 'LOCATION',
        content: loc.comment || null,
        latitude: loc.degreesLatitude || undefined,
        longitude: loc.degreesLongitude || undefined,
        locationName: loc.name || undefined,
        locationAddress: loc.address || undefined,
      };
    }

    // Live location
    if (inner.liveLocationMessage) {
      const loc = inner.liveLocationMessage;
      return {
        ...base,
        type: 'LOCATION',
        content: loc.caption || 'Position en direct',
        latitude: loc.degreesLatitude || undefined,
        longitude: loc.degreesLongitude || undefined,
      };
    }

    // Contact
    if (inner.contactMessage || inner.contactsArrayMessage) {
      const contact = inner.contactMessage;
      return {
        ...base,
        type: 'CONTACT',
        content: contact?.displayName || 'Contact partage',
      };
    }

    // Poll
    if (inner.pollCreationMessage || inner.pollCreationMessageV3) {
      const poll = inner.pollCreationMessage || inner.pollCreationMessageV3;
      return {
        ...base,
        type: 'POLL',
        content: poll?.name || 'Sondage',
      };
    }

    // Reaction
    if (inner.reactionMessage) {
      return {
        ...base,
        type: 'REACTION',
        content: inner.reactionMessage.text || null,
      };
    }

    return {
      ...base,
      type: 'UNKNOWN',
      content: null,
    };
  }

  private extractContextInfo(msg: any): any {
    const types = [
      'extendedTextMessage', 'imageMessage', 'videoMessage',
      'audioMessage', 'documentMessage', 'stickerMessage',
      'locationMessage', 'contactMessage',
    ];
    for (const t of types) {
      if (msg[t]?.contextInfo) return msg[t].contextInfo;
    }
    return null;
  }

  private async persistMessage(event: InterceptedMessageEvent): Promise<void> {
    try {
      const target = await this.prisma.target.findUnique({
        where: { jid: event.targetJid },
        select: { id: true },
      });
      if (!target) return;

      const message = await this.prisma.interceptedMessage.upsert({
        where: {
          targetId_waMessageId: {
            targetId: target.id,
            waMessageId: event.waMessageId,
          },
        },
        update: {},
        create: {
          targetId: target.id,
          waMessageId: event.waMessageId,
          type: event.type as any,
          direction: event.direction as any,
          senderJid: event.senderJid,
          chatJid: event.chatJid,
          content: event.content,
          timestamp: event.timestamp,
          isForwarded: event.isForwarded,
          isViewOnce: event.isViewOnce,
          quotedMsgId: event.quotedMsgId,
          mentions: event.mentions.length > 0 ? event.mentions : undefined,
          raw: event.raw as any,
        },
      });

      // Persist media info if present
      if (event.mediaMimeType && event.type !== 'TEXT' && event.type !== 'LOCATION' && event.type !== 'CONTACT' && event.type !== 'POLL') {
        await this.prisma.mediaFile.upsert({
          where: { messageId: message.id },
          update: {},
          create: {
            messageId: message.id,
            mimeType: event.mediaMimeType,
            fileName: event.mediaFileName,
            fileSize: event.mediaFileSize,
            thumbnailB64: event.mediaThumbnail,
            duration: event.mediaDuration,
            width: event.mediaWidth,
            height: event.mediaHeight,
          },
        });
      }

      // Persist location if present
      if (event.latitude !== undefined && event.longitude !== undefined) {
        await this.prisma.locationData.upsert({
          where: { messageId: message.id },
          update: {},
          create: {
            messageId: message.id,
            latitude: event.latitude,
            longitude: event.longitude,
            name: event.locationName,
            address: event.locationAddress,
            url: `https://maps.google.com/?q=${event.latitude},${event.longitude}`,
          },
        });
      }
    } catch (err) {
      log.error({ err, targetJid: event.targetJid }, 'Failed to persist message');
    }
  }

  private async handleDeletion(deletion: any): Promise<void> {
    try {
      if (deletion.keys) {
        // Specific messages deleted
        for (const key of deletion.keys) {
          const chatJid = key.remoteJid;
          const msgId = key.id;
          if (!chatJid || !msgId) continue;

          const monitoredTarget = this.findMonitoredJid(chatJid, key.participant || chatJid);
          if (!monitoredTarget) continue;

          const target = await this.prisma.target.findUnique({
            where: { jid: monitoredTarget },
            select: { id: true },
          });
          if (!target) continue;

          await this.prisma.interceptedMessage.updateMany({
            where: { targetId: target.id, waMessageId: msgId },
            data: { isDeleted: true, deletedAt: new Date() },
          });

          this.emit('message:deleted', {
            targetJid: monitoredTarget,
            waMessageId: msgId,
            timestamp: new Date(),
          });

          log.debug({ targetJid: monitoredTarget, msgId }, 'Message deletion detected');
        }
      }
    } catch (err) {
      log.error({ err }, 'Failed to handle message deletion');
    }
  }

  private async handleReaction(reaction: any): Promise<void> {
    try {
      const key = reaction.key;
      if (!key?.remoteJid) return;

      const chatJid = key.remoteJid;
      const monitoredTarget = this.findMonitoredJid(chatJid, key.participant || chatJid);
      if (!monitoredTarget) return;

      const target = await this.prisma.target.findUnique({
        where: { jid: monitoredTarget },
        select: { id: true },
      });
      if (!target) return;

      const emoji = reaction.reaction?.text || '';

      await this.prisma.interceptedMessage.create({
        data: {
          targetId: target.id,
          waMessageId: `reaction_${key.id}_${Date.now()}`,
          type: 'REACTION',
          direction: key.fromMe ? 'OUTGOING' : 'INCOMING',
          senderJid: this.normalizeJid(key.participant || chatJid),
          chatJid: this.normalizeJid(chatJid),
          content: emoji,
          timestamp: new Date(),
        },
      });

      this.emit('message:reaction', {
        targetJid: monitoredTarget,
        emoji,
        timestamp: new Date(),
      });
    } catch (err) {
      log.error({ err }, 'Failed to handle reaction');
    }
  }

  private isRelevantJid(jid: string): boolean {
    const normalized = this.normalizeJid(jid);
    for (const monitored of this.monitoredJids) {
      if (this.normalizeJid(monitored) === normalized) return true;
    }
    return false;
  }

  private findMonitoredJid(chatJid: string, senderJid: string): string | null {
    const normalizedChat = this.normalizeJid(chatJid);
    const normalizedSender = this.normalizeJid(senderJid);

    for (const jid of this.monitoredJids) {
      const normalized = this.normalizeJid(jid);
      if (normalized === normalizedChat || normalized === normalizedSender) {
        return jid;
      }
    }
    return null;
  }

  private normalizeJid(jid: string): string {
    return jid.replace(/:.*@/, '@').split('@')[0];
  }
}
