import * as net from 'net';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';

// ── Crypto helpers ───────────────────────────────────────────────────
/** HMAC-SHA256 for challenge-response auth */
function hmacSign(challenge: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(challenge).digest('hex');
}

/** Derive a 256-bit AES key from the shared secret using HKDF-like KDF */
function deriveSessionKey(secret: string, salt: string): Buffer {
    return crypto.createHash('sha256').update(secret + ':' + salt).digest();
}

/** AES-256-GCM encrypt — returns base64(iv + authTag + ciphertext) */
function encrypt(plaintext: string, key: Buffer): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag(); // 16 bytes
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/** AES-256-GCM decrypt — expects base64(iv + authTag + ciphertext) */
function decrypt(payload: string, key: Buffer): string | null {
    try {
        const buf = Buffer.from(payload, 'base64');
        if (buf.length < 28) return null; // 12 iv + 16 tag minimum
        const iv = buf.subarray(0, 12);
        const authTag = buf.subarray(12, 28);
        const ciphertext = buf.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return decrypted.toString('utf8');
    } catch (_e) {
        return null; // tampered or wrong key
    }
}

// ── Types ────────────────────────────────────────────────────────────
export interface TeamMember {
    id: string;
    name: string;
    role: string;
    isKing: boolean;
    connected: boolean;
    lastSeen: number;
}

export interface TaskItem {
    id: string;
    title: string;
    owner: string;
    status: 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked';
    description: string;
    createdAt: number;
    updatedAt: number;
}

export interface AgentUpdate {
    agentName: string;
    type: 'status' | 'task_update' | 'message' | 'review_request' | 'review_response';
    content: string;
    taskId?: string;
    timestamp: number;
}

export type P2PEvent =
    | { type: 'member_joined'; member: TeamMember }
    | { type: 'member_left'; memberId: string }
    | { type: 'task_sync'; tasks: TaskItem[] }
    | { type: 'team_sync'; members: TeamMember[] }
    | { type: 'chat_message'; sender: string; text: string; timestamp: number }
    | { type: 'agent_update'; update: AgentUpdate }
    | { type: 'king_message'; to: string; content: string }
    | { type: 'connected' }
    | { type: 'disconnected' };

type P2PEventHandler = (event: P2PEvent) => void;

const DELIMITER = '\n__GNANA_MSG__\n';
const ENCRYPTED_DELIMITER = '\n__GNANA_ENC__\n';
const MAX_MESSAGE_SIZE = 256 * 1024;
const MAX_BUFFER_SIZE = 1024 * 1024;
const VALID_EVENT_TYPES = ['member_joined', 'member_left', 'task_sync', 'team_sync', 'chat_message', 'agent_update', 'king_message'];

// ── P2PManager ───────────────────────────────────────────────────────
export class P2PManager extends EventEmitter {
    private localId: string;
    private localName: string;
    private localRole: string;
    private isKing: boolean;
    private sessionSecret: string;
    private sessionKey: Buffer | null = null;
    private server: net.Server | null = null;
    private clientSocket: net.Socket | null = null;
    private peers: Map<string, {
        socket: net.Socket;
        member: TeamMember;
        authenticated: boolean;
        challenge?: string;
        sessionKey?: Buffer;
        sendSeq: number;  // monotonic counter for outgoing messages
        recvSeq: number;  // last accepted seq from this peer
    }> = new Map();
    private handlers: P2PEventHandler[] = [];
    private port: number = 9777;
    private reconnectInterval: ReturnType<typeof setInterval> | null = null;
    private connectResolve: (() => void) | null = null;
    private connectReject: ((err: Error) => void) | null = null;
    // Agent-side sequence counters (single connection to King)
    private agentSendSeq: number = 0;
    private agentRecvSeq: number = 0;

    constructor(localName: string, localRole: string, isKing: boolean, sessionSecret?: string) {
        super();
        this.localId = crypto.randomBytes(8).toString('hex');
        this.localName = localName;
        this.localRole = localRole;
        this.isKing = isKing;
        this.sessionSecret = sessionSecret || crypto.randomBytes(16).toString('hex');
    }

    getSessionSecret(): string {
        return this.sessionSecret;
    }

    // ── Server (King) ────────────────────────────────────────────────
    async startServer(port?: number, bindAddress?: string): Promise<string> {
        this.port = port || 9777;
        const bind = bindAddress || '0.0.0.0';
        return new Promise((resolve, reject) => {
            this.server = net.createServer((socket) => {
                this.handleIncomingConnection(socket);
            });

            this.server.on('error', (err: Error) => {
                if ((err as any).code === 'EADDRINUSE') {
                    this.port++;
                    this.server!.listen(this.port, bind);
                } else {
                    reject(err);
                }
            });

            this.server.listen(this.port, bind, () => {
                const address = bind === '0.0.0.0' ? this.getLocalIP() : bind;
                resolve(`${address}:${this.port}`);
            });
        });
    }

    // ── Client (Agent) ───────────────────────────────────────────────
    async connectToKing(host: string, port: number): Promise<void> {
        return new Promise((resolve, reject) => {
            this.connectResolve = resolve;
            this.connectReject = reject;
            let authFailed = false;

            // Timeout if handshake doesn't complete within 10 seconds
            const authTimeout = setTimeout(() => {
                if (this.connectReject) {
                    this.connectReject(new Error('Authentication timed out'));
                    this.connectResolve = null;
                    this.connectReject = null;
                    authFailed = true;
                    this.clientSocket?.destroy();
                }
            }, 10000);

            this.clientSocket = net.createConnection({ host, port }, () => {
                // Step 1: request challenge (no secret on wire)
                this.sendPlaintext(this.clientSocket!, {
                    type: 'handshake_request',
                    member: this.getLocalMember()
                });
            });

            let buffer = '';
            this.clientSocket.on('data', (data: Buffer) => {
                buffer += data.toString();
                if (buffer.length > MAX_BUFFER_SIZE) { buffer = ''; return; }

                // Try encrypted delimiter first, then plaintext (for handshake)
                this.processBuffer(buffer, null, true, (rest) => { buffer = rest; });
                
                // If auth succeeded, clear the timeout
                if (!this.connectResolve && !authFailed) {
                    clearTimeout(authTimeout);
                }
            });

            this.clientSocket.on('close', () => {
                clearTimeout(authTimeout);
                this.emitEvent({ type: 'disconnected' });
                // Only auto-reconnect if auth previously succeeded
                if (!authFailed && !this.connectReject) {
                    this.tryReconnect(host, port);
                }
            });

            this.clientSocket.on('error', (err: Error) => {
                clearTimeout(authTimeout);
                if ((err as any).code === 'ECONNREFUSED') {
                    reject(new Error(`Cannot connect to King at ${host}:${port}`));
                } else {
                    reject(err);
                }
            });
        });
    }

    private tryReconnect(host: string, port: number): void {
        if (this.reconnectInterval) return;
        this.reconnectInterval = setInterval(async () => {
            try {
                await this.connectToKing(host, port);
                if (this.reconnectInterval) {
                    clearInterval(this.reconnectInterval);
                    this.reconnectInterval = null;
                }
            } catch (_e) { /* retry */ }
        }, 5000);
    }

    // ── Incoming connection handler (King side) ──────────────────────
    private handleIncomingConnection(socket: net.Socket): void {
        let buffer = '';
        let authenticated = false;
        let peerId: string | null = null;

        const authTimeout = setTimeout(() => {
            if (!authenticated) socket.destroy();
        }, 10000);

        socket.on('data', (data: Buffer) => {
            buffer += data.toString();
            if (buffer.length > MAX_BUFFER_SIZE) { socket.destroy(); return; }

            this.processBuffer(buffer, socket, authenticated, (rest) => {
                buffer = rest;
                // Check if authentication happened during processing
                if (!authenticated && peerId) {
                    const peer = this.peers.get(peerId);
                    if (peer && peer.authenticated) {
                        authenticated = true;
                        clearTimeout(authTimeout);
                    }
                }
            }, (id) => { peerId = id; });
        });

        socket.on('close', () => {
            clearTimeout(authTimeout);
            if (peerId) {
                const peer = this.peers.get(peerId);
                if (peer) {
                    peer.member.connected = false;
                    this.emitEvent({ type: 'member_left', memberId: peerId });
                    this.peers.delete(peerId);
                }
            }
        });

        socket.on('error', () => { clearTimeout(authTimeout); });
    }

    // ── Buffer processing (handles both plaintext handshake and encrypted messages) ──
    private processBuffer(
        buffer: string,
        socket: net.Socket | null,
        authenticated: boolean,
        setRest: (rest: string) => void,
        onPeerId?: (id: string) => void
    ): void {
        // Process encrypted messages first
        if (buffer.includes(ENCRYPTED_DELIMITER)) {
            const parts = buffer.split(ENCRYPTED_DELIMITER);
            setRest(parts.pop() || '');
            for (const part of parts) {
                if (part.trim() && part.length <= MAX_MESSAGE_SIZE) {
                    // Determine which key to use
                    const key = this.getDecryptionKey(socket);
                    if (key) {
                        const plaintext = decrypt(part.trim(), key);
                        if (plaintext) {
                            try {
                                const msg = JSON.parse(plaintext);
                                this.handleMessage(msg, socket, true); // encrypted = authenticated
                            } catch (_e) { /* ignore */ }
                        }
                        // If decrypt fails, message was tampered — silently drop
                    }
                }
            }
            return;
        }

        // Process plaintext messages (handshake only)
        if (buffer.includes(DELIMITER)) {
            const parts = buffer.split(DELIMITER);
            setRest(parts.pop() || '');
            for (const part of parts) {
                if (part.trim() && part.length <= MAX_MESSAGE_SIZE) {
                    try {
                        const msg = JSON.parse(part);
                        const resultPeerId = this.handleMessage(msg, socket, authenticated);
                        if (resultPeerId && onPeerId) onPeerId(resultPeerId);
                    } catch (_e) { /* ignore */ }
                }
            }
        }
    }

    // ── Message handler ──────────────────────────────────────────────
    private handleMessage(msg: any, socket: net.Socket | null, authenticated: boolean): string | null {
        // Step 1: Agent requests handshake -> King sends challenge
        if (msg.type === 'handshake_request' && msg.member && socket) {
            const challenge = crypto.randomBytes(32).toString('hex');
            const tempId = msg.member.id || 'pending-' + crypto.randomBytes(4).toString('hex');
            this.peers.set(tempId, { socket, member: msg.member, authenticated: false, challenge, sendSeq: 0, recvSeq: 0 });
            this.sendPlaintext(socket, { type: 'handshake_challenge', challenge, peerId: tempId });
            return tempId;
        }

        // Step 2: Agent signs challenge with HMAC
        if (msg.type === 'handshake_challenge' && msg.challenge) {
            const proof = hmacSign(msg.challenge, this.sessionSecret);
            this.sendPlaintext(this.clientSocket!, {
                type: 'handshake_response',
                proof,
                peerId: msg.peerId,
                challenge: msg.challenge, // echo back for key derivation
                member: this.getLocalMember()
            });
            // Derive session key from secret + challenge (both sides know these)
            this.sessionKey = deriveSessionKey(this.sessionSecret, msg.challenge);
            return null;
        }

        // Step 3: King verifies HMAC and derives session key
        if (msg.type === 'handshake_response' && msg.proof && msg.peerId && socket) {
            const peer = this.peers.get(msg.peerId);
            if (!peer || !peer.challenge) {
                this.sendPlaintext(socket, { type: 'handshake_rejected', reason: 'Unknown peer' });
                setTimeout(() => socket.destroy(), 100);
                return null;
            }

            const expectedProof = hmacSign(peer.challenge, this.sessionSecret);
            if (msg.proof !== expectedProof) {
                this.sendPlaintext(socket, { type: 'handshake_rejected', reason: 'Authentication failed' });
                this.peers.delete(msg.peerId);
                setTimeout(() => socket.destroy(), 100);
                return null;
            }

            // Derive per-peer session key
            peer.sessionKey = deriveSessionKey(this.sessionSecret, peer.challenge);
            delete peer.challenge;
            peer.authenticated = true;
            const member: TeamMember = msg.member || peer.member;
            peer.member = member;
            this.emitEvent({ type: 'member_joined', member });

            // Send ack (encrypted now that we have the key)
            this.sendEncrypted(socket, peer.sessionKey, {
                type: 'handshake_ack',
                member: this.getLocalMember(),
                existingMembers: this.getAllMembers()
            });
            return msg.peerId;
        }

        // Handshake ACK (Agent receives, already encrypted)
        if (msg.type === 'handshake_ack' && msg.member) {
            this.emitEvent({ type: 'connected' });
            this.emitEvent({ type: 'member_joined', member: msg.member });
            if (msg.existingMembers) {
                for (const m of msg.existingMembers) {
                    if (m.id !== this.localId) {
                        this.emitEvent({ type: 'member_joined', member: m });
                    }
                }
            }
            if (this.connectResolve) {
                this.connectResolve();
                this.connectResolve = null;
                this.connectReject = null;
            }
            return null;
        }

        if (msg.type === 'handshake_rejected') {
            this.emitEvent({ type: 'disconnected' });
            if (this.connectReject) {
                this.connectReject(new Error(msg.reason || 'Authentication rejected'));
                this.connectResolve = null;
                this.connectReject = null;
            }
            return null;
        }

        // Post-handshake event messages (must be authenticated + replay-checked)
        if (!authenticated) return null;

        // Wrapped event messages with replay protection
        if (msg.event && typeof msg.event === 'object') {
            if (msg.seq === undefined) return null; // require seq on all event messages
            const seq = msg.seq as number;
            if (!this.checkAndUpdateSeq(socket, seq)) return null; // replay or out-of-order
            const event = msg.event as P2PEvent;
            if (!VALID_EVENT_TYPES.includes(event.type)) return null;
            this.emitEvent(event);
        }
        return null;
    }

    // ── Send methods ─────────────────────────────────────────────────
    /** Send unencrypted (handshake only) */
    private sendPlaintext(socket: net.Socket, data: any): void {
        try {
            const payload = JSON.stringify(data);
            if (payload.length <= MAX_MESSAGE_SIZE) {
                socket.write(payload + DELIMITER);
            }
        } catch (_e) { /* socket closed */ }
    }

    /** Send encrypted with AES-256-GCM + sequence number for replay protection */
    private sendEncrypted(socket: net.Socket, key: Buffer, data: any): void {
        try {
            // Attach monotonic sequence number
            const seq = this.nextSendSeq(socket);
            const envelope = { ...data, seq };
            const plaintext = JSON.stringify(envelope);
            if (plaintext.length <= MAX_MESSAGE_SIZE) {
                const encrypted = encrypt(plaintext, key);
                socket.write(encrypted + ENCRYPTED_DELIMITER);
            }
        } catch (_e) { /* socket closed */ }
    }

    /** Get next send seq for a socket */
    private nextSendSeq(socket: net.Socket): number {
        if (this.isKing) {
            for (const peer of this.peers.values()) {
                if (peer.socket === socket) return ++peer.sendSeq;
            }
        }
        return ++this.agentSendSeq;
    }

    /** Check incoming seq against last seen; update if valid */
    private checkAndUpdateSeq(socket: net.Socket | null, seq: number): boolean {
        if (this.isKing && socket) {
            for (const peer of this.peers.values()) {
                if (peer.socket === socket) {
                    if (seq <= peer.recvSeq) return false; // replay
                    peer.recvSeq = seq;
                    return true;
                }
            }
        } else {
            if (seq <= this.agentRecvSeq) return false; // replay
            this.agentRecvSeq = seq;
            return true;
        }
        return false;
    }

    /** Get the decryption key for a given socket */
    private getDecryptionKey(socket: net.Socket | null): Buffer | null {
        // Agent side: single session key
        if (!this.isKing && this.sessionKey) return this.sessionKey;
        // King side: look up peer by socket
        if (socket) {
            for (const peer of this.peers.values()) {
                if (peer.socket === socket && peer.sessionKey) return peer.sessionKey;
            }
        }
        return null;
    }

    /** Send encrypted event to a specific peer by ID (not name — avoids spoofing) */
    sendToPeerId(peerId: string, event: P2PEvent): boolean {
        const peer = this.peers.get(peerId);
        if (peer && peer.authenticated && peer.sessionKey && peer.socket && !peer.socket.destroyed) {
            this.sendEncrypted(peer.socket, peer.sessionKey, { event });
            return true;
        }
        return false;
    }

    /** Find peer ID by name. Returns null if not found or ambiguous (multiple matches). */
    findPeerIdByName(name: string): string | null {
        let found: string | null = null;
        for (const [id, peer] of this.peers.entries()) {
            if (peer.member.name === name && peer.authenticated) {
                if (found !== null) return null; // ambiguous — two peers with same name
                found = id;
            }
        }
        return found;
    }

    /** Broadcast encrypted event to all authenticated peers */
    broadcast(event: P2PEvent): void {
        if (this.isKing) {
            for (const peer of this.peers.values()) {
                if (peer.authenticated && peer.sessionKey && peer.socket && !peer.socket.destroyed) {
                    this.sendEncrypted(peer.socket, peer.sessionKey, { event });
                }
            }
        } else if (this.clientSocket && !this.clientSocket.destroyed && this.sessionKey) {
            this.sendEncrypted(this.clientSocket, this.sessionKey, { event });
        }
    }

    // ── Event system ─────────────────────────────────────────────────
    on(handler: any): this {
        if (typeof handler === 'function' && handler.length <= 1) {
            this.handlers.push(handler as P2PEventHandler);
        }
        return super.on('event', handler);
    }

    private emitEvent(event: P2PEvent): void {
        for (const handler of this.handlers) {
            try { handler(event); } catch (_e) { /* handler error */ }
        }
    }

    // ── Member info ──────────────────────────────────────────────────
    getLocalMember(): TeamMember {
        return {
            id: this.localId,
            name: this.localName,
            role: this.localRole,
            isKing: this.isKing,
            connected: true,
            lastSeen: Date.now()
        };
    }

    getAllMembers(): TeamMember[] {
        const members: TeamMember[] = [this.getLocalMember()];
        for (const peer of this.peers.values()) {
            members.push(peer.member);
        }
        return members;
    }

    getConnectedPeers(): TeamMember[] {
        const members: TeamMember[] = [];
        for (const peer of this.peers.values()) {
            if (peer.authenticated) members.push(peer.member);
        }
        return members;
    }

    private getLocalIP(): string {
        const os = require('os');
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name] || []) {
                if (iface.family === 'IPv4' && !iface.internal) return iface.address;
            }
        }
        return '127.0.0.1';
    }

    getPort(): number { return this.port; }

    disconnect(): void {
        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
        }
        for (const peer of this.peers.values()) {
            if (peer.socket && !peer.socket.destroyed) peer.socket.destroy();
        }
        this.peers.clear();
        if (this.clientSocket && !this.clientSocket.destroyed) {
            this.clientSocket.destroy();
            this.clientSocket = null;
        }
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        this.sessionKey = null;
        this.emitEvent({ type: 'disconnected' });
    }
}
