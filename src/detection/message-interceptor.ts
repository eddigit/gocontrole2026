import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import type { ConnectionManager } from '../whatsapp/connection-manager.js';
import { findOrCreateTarget } from '../utils/find-or-create-target.js';
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
 * Captures ALL incoming and outgoing WhatsApp messages (no JID filter),
 * classifies their type, and persists them to the database.
 * Auto-creates Target entries for new contacts encountered.
 */
export class MessageInterceptor extends EventEmitter {
  constructor(
    private readonly connection: ConnectionManager,
    private readonly prisma: PrismaClient,
    private readonly sessionId: string,
  ) {
    super();
  }

  async start(): Promise<void> {
    // Listen for real-time messages (notify = real-time, append = synced)
    this.connection.onBaileysEvent('messages.upsert', (upsert) => {
      const { messages, type } = upsert as { messages: any[]; type: string };
      // Accept both 'notify' (real-time) and 'append' (sync)
      if (type !== 'notify' && type !== 'append') return;

      for (const msg of messages) {
        this.handleMessage(msg).catch(err => {
          log.error({ err }, 'Error handling message');
        });
      }
    });

    // Listen for history sync (initial pairing dumps old messages)
    // MVP: import max 100 messages from history to avoid overload
    let historyImported = 0;
    const HISTORY_IMPORT_LIMIT = 100;

    this.connection.onBaileysEvent('messaging-history.set', (data) => {
      const { messages } = data as { messages: any[] };
      log.info({ count: messages.length, imported: historyImported }, 'History sync batch received');

      for (const msg of messages) {
        if (historyImported >= HISTORY_IMPORT_LIMIT) {
          log.info({ limit: HISTORY_IMPORT_LIMIT }, 'History import limit reached, skipping rest');
          return;
        }
        historyImported++;
        this.handleMessage(msg).catch(err => {
          log.error({ err }, 'Error handling history message');
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

    log.info('Message interceptor started (capturing all traffic)');
  }

  stop(): void {
    log.info('Message interceptor stopped');
  }

  private async handleMessage(msg: any): Promise<void> {
    const key = msg.key;
    if (!key) return;

    const chatJid = key.remoteJid;
    if (!chatJid) return;

    // Determine the sender
    const senderJid = key.fromMe
      ? (this.connection.socket?.user?.id ?? 'unknown')
      : (key.participant || chatJid);

    // For 1:1 chats: targetJid = the other person
    // For groups: targetJid = senderJid (the person who sent in the group)
    const targetJid = chatJid.endsWith('@g.us')
      ? senderJid
      : (key.fromMe ? chatJid : senderJid);

    const messageContent = msg.message;
    if (!messageContent) return;

    // Classify the message type and extract content
    const parsed = this.parseMessage(messageContent);

    const event: InterceptedMessageEvent = {
      targetJid: this.normalizeJid(targetJid),
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

    // Activity detection: outgoing message = child is active NOW
    if (event.direction === 'OUTGOING') {
      await this.markChildActive();
    }

    // Emit for real-time broadcasting
    this.emit('message', event);

    log.debug({ targetJid: event.targetJid, type: parsed.type, direction: event.direction }, 'Message intercepted');
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
      // Auto-create target if it doesn't exist
      const targetId = await findOrCreateTarget(this.prisma, event.targetJid, this.sessionId);
      if (!targetId) return;

      const message = await this.prisma.interceptedMessage.upsert({
        where: {
          targetId_waMessageId: {
            targetId,
            waMessageId: event.waMessageId,
          },
        },
        update: {},
        create: {
          targetId,
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
        for (const key of deletion.keys) {
          const chatJid = key.remoteJid;
          const msgId = key.id;
          if (!chatJid || !msgId) continue;

          const contactJid = this.normalizeJid(key.participant || chatJid);
          const targetId = await findOrCreateTarget(this.prisma, contactJid, this.sessionId);
          if (!targetId) continue;

          await this.prisma.interceptedMessage.updateMany({
            where: { targetId, waMessageId: msgId },
            data: { isDeleted: true, deletedAt: new Date() },
          });

          this.emit('message:deleted', {
            targetJid: contactJid,
            waMessageId: msgId,
            timestamp: new Date(),
          });

          log.debug({ targetJid: contactJid, msgId }, 'Message deletion detected');
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
      const contactJid = this.normalizeJid(key.participant || chatJid);
      const targetId = await findOrCreateTarget(this.prisma, contactJid, this.sessionId);
      if (!targetId) return;

      const emoji = reaction.reaction?.text || '';

      await this.prisma.interceptedMessage.create({
        data: {
          targetId,
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
        targetJid: contactJid,
        emoji,
        timestamp: new Date(),
      });
    } catch (err) {
      log.error({ err }, 'Failed to handle reaction');
    }
  }

  /**
   * Mark the child (session owner) as active when they send a message.
   * This replaces broken presenceSubscribe for activity detection.
   */
  private async markChildActive(): Promise<void> {
    try {
      await this.prisma.target.updateMany({
        where: { sessionId: this.sessionId },
        data: { status: 'ONLINE', lastSeen: new Date(), updatedAt: new Date() },
      });
    } catch (err) {
      log.error({ err }, 'Failed to mark child active');
    }
  }

  private normalizeJid(jid: string): string {
    return jid.replace(/:.*@/, '@');
  }
}
