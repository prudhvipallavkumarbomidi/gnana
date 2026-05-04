import { KingAgent } from '../king/kingAgent';
import { P2PManager, TeamMember, TaskItem, AgentUpdate, P2PEvent } from '../p2p/p2pManager';
import { LocalApi, validationError } from '../api/localApi';

// Bounded log limits
const MAX_FEED_ENTRIES = 500;
const MAX_CHAT_ENTRIES = 200;
const MAX_REVIEW_ENTRIES = 100;
const MAX_CONTENT_LENGTH = 10000; // 10K chars per message

export interface GnanaSession {
    isKing: boolean;
    agentName: string;
    agentRole: string;
    serverAddress?: string;
    team: TeamMember[];
    tasks: TaskItem[];
    liveFeed: AgentUpdate[];
    kingMessages: { to: string; content: string; timestamp: number }[];
    kingChatLog: { role: string; content: string; timestamp: number }[];
}

export class SessionManager {
    private king: KingAgent | null = null;
    private p2p: P2PManager | null = null;
    private api: LocalApi | null = null;
    private session: GnanaSession | null = null;
    private onUpdate: () => void;

    constructor(onUpdate: () => void) {
        this.onUpdate = onUpdate;
    }

    async startAsKing(agentName: string, agentRole: string, port?: number, bindAddress?: string): Promise<string> {
        this.king = new KingAgent();
        this.p2p = new P2PManager(agentName, agentRole, true);

        const address = await this.p2p.startServer(port || 9777, bindAddress);

        this.session = {
            isKing: true,
            agentName,
            agentRole,
            serverAddress: address,
            team: [this.p2p.getLocalMember()],
            tasks: [],
            liveFeed: [],
            kingMessages: [],
            kingChatLog: []
        };

        this.setupP2PHandlers();
        await this.startLocalApi();

        this.appendFeed({
            agentName: 'System', type: 'status',
            content: `King session started by ${agentName}. Server: ${address}`,
            timestamp: Date.now()
        });

        this.onUpdate();
        return address;
    }

    async joinAsAgent(agentName: string, agentRole: string, host: string, port: number, sessionSecret: string): Promise<void> {
        this.p2p = new P2PManager(agentName, agentRole, false, sessionSecret);

        this.session = {
            isKing: false,
            agentName,
            agentRole,
            serverAddress: `${host}:${port}`,
            team: [this.p2p.getLocalMember()],
            tasks: [],
            liveFeed: [],
            kingMessages: [],
            kingChatLog: []
        };

        this.setupP2PHandlers();
        await this.p2p.connectToKing(host, port);
        await this.startLocalApi();

        this.appendFeed({
            agentName: 'System', type: 'status',
            content: `${agentName} joined the session at ${host}:${port}`,
            timestamp: Date.now()
        });

        this.onUpdate();
    }

    /**
     * Append to feed with bounded size.
     */
    private appendFeed(update: AgentUpdate): void {
        if (!this.session) return;
        this.session.liveFeed.push(update);
        if (this.session.liveFeed.length > MAX_FEED_ENTRIES) {
            this.session.liveFeed = this.session.liveFeed.slice(-MAX_FEED_ENTRIES);
        }
    }

    /**
     * Append to chat log with bounded size.
     */
    private appendChat(entry: { role: string; content: string; timestamp: number }): void {
        if (!this.session) return;
        this.session.kingChatLog.push(entry);
        if (this.session.kingChatLog.length > MAX_CHAT_ENTRIES) {
            this.session.kingChatLog = this.session.kingChatLog.slice(-MAX_CHAT_ENTRIES);
        }
    }

    /**
     * Append to reviews with bounded size.
     */
    private appendReview(entry: { to: string; content: string; timestamp: number }): void {
        if (!this.session) return;
        this.session.kingMessages.push(entry);
        if (this.session.kingMessages.length > MAX_REVIEW_ENTRIES) {
            this.session.kingMessages = this.session.kingMessages.slice(-MAX_REVIEW_ENTRIES);
        }
    }

    /**
     * Truncate content to max length.
     */
    private truncate(content: string): string {
        return content.length > MAX_CONTENT_LENGTH
            ? content.substring(0, MAX_CONTENT_LENGTH) + '... [truncated]'
            : content;
    }

    private async startLocalApi(): Promise<void> {
        this.api = new LocalApi(this.session?.isKing ? 9778 : 9779);

        // GET /api/status — no secrets exposed
        this.api.route('GET', '/api/status', async () => {
            return {
                active: this.session !== null,
                isKing: this.session?.isKing || false,
                agentName: this.session?.agentName || '',
                agentRole: this.session?.agentRole || '',
                serverAddress: this.session?.serverAddress || '',
                teamSize: this.session?.team.length || 0,
                taskCount: this.session?.tasks.length || 0,
                feedCount: this.session?.liveFeed.length || 0,
                apiVersion: '1.2.0'
            };
        });

        // GET /api/feed
        this.api.route('GET', '/api/feed', async () => {
            return { feed: this.session?.liveFeed || [] };
        });

        // GET /api/tasks
        this.api.route('GET', '/api/tasks', async () => {
            return { tasks: this.session?.tasks || [] };
        });

        // GET /api/team
        this.api.route('GET', '/api/team', async () => {
            return { team: this.session?.team || [] };
        });

        // GET /api/chat
        this.api.route('GET', '/api/chat', async () => {
            return { chat: this.session?.kingChatLog || [] };
        });

        // POST /api/chat — post to King chat log
        this.api.route('POST', '/api/chat', async (body: any) => {
            if (!body.content || typeof body.content !== 'string' || !body.content.trim()) {
                throw validationError('Missing or empty "content" field');
            }
            const content = this.truncate(body.content.trim());
            const role = body.role || 'king';
            const entry = { role, content, timestamp: Date.now() };

            this.appendChat(entry);
            this.appendFeed({
                agentName: role === 'king' ? 'King' : (this.session?.agentName || 'Unknown'),
                type: 'message', content, timestamp: Date.now()
            });

            // Directed message: send to specific peer by ID, not broadcast
            if (body.to && this.p2p) {
                const peerId = this.p2p.findPeerIdByName(body.to);
                if (peerId) {
                    this.p2p.sendToPeerId(peerId, { type: 'king_message', to: body.to, content });
                }
                this.appendReview({ to: body.to, content, timestamp: Date.now() });
            }

            this.onUpdate();
            return { ok: true, entry };
        });

        // POST /api/update — post agent update
        this.api.route('POST', '/api/update', async (body: any) => {
            if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
                throw validationError('Missing or empty "text" field');
            }
            const validTypes = ['status', 'task_update', 'message', 'review_request', 'review_response'];
            const type = body.type || 'status';
            if (!validTypes.includes(type)) {
                throw validationError(`Invalid "type". Must be one of: ${validTypes.join(', ')}`);
            }
            this.sendAgentUpdate(this.truncate(body.text.trim()), type, body.taskId);
            return { ok: true };
        });

        // POST /api/task
        this.api.route('POST', '/api/task', async (body: any) => {
            if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
                throw validationError('Missing or empty "title" field');
            }
            if (body.title.length > 200) {
                throw validationError('Title too long (max 200 chars)');
            }
            this.addTask({
                title: body.title.trim(),
                owner: (body.owner || '').trim().substring(0, 100),
                status: 'todo',
                description: this.truncate((body.description || '').trim())
            });
            return { ok: true, taskCount: this.session?.tasks.length || 0 };
        });

        // POST /api/task/status
        this.api.route('POST', '/api/task/status', async (body: any) => {
            if (!body.taskId || typeof body.taskId !== 'string') {
                throw validationError('Missing "taskId" field');
            }
            const validStatuses = ['todo', 'in_progress', 'in_review', 'done', 'blocked'];
            if (!body.status || !validStatuses.includes(body.status)) {
                throw validationError(`Invalid "status". Must be one of: ${validStatuses.join(', ')}`);
            }
            const task = this.session?.tasks.find(t => t.id === body.taskId);
            if (!task) {
                throw validationError(`Task not found: ${body.taskId}`);
            }
            this.updateTaskStatus(body.taskId, body.status);
            return { ok: true };
        });

        // POST /api/review — directed review to a specific agent
        this.api.route('POST', '/api/review', async (body: any) => {
            if (!body.to || typeof body.to !== 'string' || !body.to.trim()) {
                throw validationError('Missing "to" field (agent name)');
            }
            if (!body.content || typeof body.content !== 'string' || !body.content.trim()) {
                throw validationError('Missing "content" field (review text)');
            }
            const content = this.truncate(body.content.trim());
            this.sendDirectedKingMessage(body.to.trim(), content);
            return { ok: true };
        });

        // POST /api/disconnect
        this.api.route('POST', '/api/disconnect', async () => {
            this.disconnect();
            return { ok: true, disconnected: true };
        });

        const apiPort = await this.api.start();
        const apiToken = this.api.getToken();

        if (this.session) {
            this.appendFeed({
                agentName: 'System', type: 'status',
                content: `Local API on http://127.0.0.1:${apiPort} | Token: ${apiToken}`,
                timestamp: Date.now()
            });
        }
    }

    private setupP2PHandlers(): void {
        if (!this.p2p || !this.session) return;

        this.p2p.on((event: P2PEvent) => {
            if (!this.session) return;

            switch (event.type) {
                case 'member_joined': {
                    const exists = this.session.team.find(m => m.id === event.member.id);
                    if (!exists) {
                        this.session.team.push(event.member);
                        this.appendFeed({
                            agentName: 'System', type: 'status',
                            content: `${event.member.name} (${event.member.role}) joined`,
                            timestamp: Date.now()
                        });
                    }
                    break;
                }
                case 'member_left': {
                    const member = this.session.team.find(m => m.id === event.memberId);
                    if (member) {
                        member.connected = false;
                        this.appendFeed({
                            agentName: 'System', type: 'status',
                            content: `${member.name} disconnected`,
                            timestamp: Date.now()
                        });
                    }
                    break;
                }
                case 'task_sync':
                    // Only King is authoritative for tasks
                    if (!this.session.isKing) {
                        this.session.tasks = event.tasks;
                    }
                    break;

                case 'agent_update':
                    // Validate and truncate incoming updates
                    if (event.update && event.update.content) {
                        event.update.content = this.truncate(event.update.content);
                        this.appendFeed(event.update);
                    }
                    break;

                case 'king_message':
                    // Only accept if directed to this agent (privacy fix)
                    if (event.to === this.session.agentName || this.session.isKing) {
                        this.appendReview({
                            to: event.to,
                            content: this.truncate(event.content),
                            timestamp: Date.now()
                        });
                        this.appendFeed({
                            agentName: 'King', type: 'review_response',
                            content: this.truncate(event.content),
                            timestamp: Date.now()
                        });
                    }
                    break;

                case 'connected':
                case 'disconnected':
                    break;
            }

            this.onUpdate();
        });
    }

    async sendToKing(message: string, onChunk?: (chunk: string) => void): Promise<string> {
        if (!this.king) throw new Error('King agent not initialized.');
        return this.king.sendMessage(message, onChunk);
    }

    sendAgentUpdate(content: string, type: AgentUpdate['type'], taskId?: string): void {
        if (!this.session || !this.p2p) return;
        const update: AgentUpdate = {
            agentName: this.session.agentName, type,
            content: this.truncate(content), taskId, timestamp: Date.now()
        };
        this.appendFeed(update);
        this.p2p.broadcast({ type: 'agent_update', update });
        this.onUpdate();
    }

    /**
     * Send directed King message — only to the target peer, not broadcast.
     */
    sendDirectedKingMessage(to: string, content: string): void {
        if (!this.session || !this.p2p) return;
        const truncated = this.truncate(content);

        // Resolve name -> ID, then send encrypted to that specific peer
        const peerId = this.p2p.findPeerIdByName(to);
        if (peerId) {
            this.p2p.sendToPeerId(peerId, { type: 'king_message', to, content: truncated });
        }
        // Always record locally even if peer not currently connected
        this.appendReview({ to, content: truncated, timestamp: Date.now() });
        this.appendFeed({
            agentName: 'King', type: 'review_response',
            content: `[To ${to}] ${truncated.substring(0, 200)}...`,
            timestamp: Date.now()
        });
        this.onUpdate();
    }

    addTask(task: Omit<TaskItem, 'id' | 'createdAt' | 'updatedAt'>): void {
        if (!this.session || !this.p2p) return;
        const newTask: TaskItem = {
            ...task,
            id: 'task-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        this.session.tasks.push(newTask);
        this.p2p.broadcast({ type: 'task_sync', tasks: this.session.tasks });
        this.appendFeed({
            agentName: this.session.agentName, type: 'task_update',
            content: `Created task "${newTask.title}" -> ${newTask.owner}`,
            taskId: newTask.id, timestamp: Date.now()
        });
        this.onUpdate();
    }

    updateTaskStatus(taskId: string, status: TaskItem['status']): void {
        if (!this.session || !this.p2p) return;
        const task = this.session.tasks.find(t => t.id === taskId);
        if (!task) return;
        const oldStatus = task.status;
        task.status = status;
        task.updatedAt = Date.now();
        this.p2p.broadcast({ type: 'task_sync', tasks: this.session.tasks });
        this.appendFeed({
            agentName: this.session.agentName, type: 'task_update',
            content: `Moved "${task.title}" from ${oldStatus} -> ${status}`,
            taskId: task.id, timestamp: Date.now()
        });
        this.onUpdate();
    }

    getSession(): GnanaSession | null { return this.session; }
    getApiPort(): number | null { return this.api ? this.api.getPort() : null; }
    getApiToken(): string | null { return this.api ? this.api.getToken() : null; }
    getSessionSecret(): string | null { return this.p2p ? this.p2p.getSessionSecret() : null; }
    getP2PPort(): number | null { return this.p2p ? this.p2p.getPort() : null; }
    isActive(): boolean { return this.session !== null; }

    /**
     * Public entry point for adding chat entries from the UI.
     * Routes through bounded appendChat + truncation.
     */
    addChatEntry(role: string, content: string): void {
        if (!this.session) return;
        const truncated = this.truncate(content.trim());
        if (!truncated) return;
        this.appendChat({ role, content: truncated, timestamp: Date.now() });
        this.sendAgentUpdate(truncated, 'message');
        this.onUpdate();
    }

    disconnect(): void {
        if (this.api) { this.api.stop(); this.api = null; }
        if (this.p2p) { this.p2p.disconnect(); this.p2p = null; }
        if (this.king) { this.king.clearHistory(); this.king = null; }
        this.session = null;
        this.onUpdate();
    }
}
