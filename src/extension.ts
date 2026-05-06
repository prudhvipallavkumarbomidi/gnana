import * as vscode from 'vscode';
import { SessionManager } from './agents/sessionManager';
import { GnanaSidebarProvider } from './ui/sidebarProvider';
import { NgrokTunnel } from './tunnel/ngrokTunnel';
import { AIService } from './king/aiService';
import { KING_SYSTEM_PROMPT } from './king/kingAgent';

let sessionManager: SessionManager;
let sidebarProvider: GnanaSidebarProvider;
let ngrokTunnel: NgrokTunnel | null = null;
let kingAI: AIService | null = null;
let agentAI: AIService | null = null;

export function activate(context: vscode.ExtensionContext) {
    sessionManager = new SessionManager(() => {
        const session = sessionManager.getSession();
        sidebarProvider.syncState(session);
    });
    sessionManager.onTeamChat = (msg) => {
        sidebarProvider.postMessage({ type: 'team_chat_msg', ...msg });
    };

    sidebarProvider = new GnanaSidebarProvider(context.extensionUri, async (msg: any) => {
        const config = vscode.workspace.getConfiguration('gnana');

        switch (msg.type) {
            case 'start_king': {
                const agentName = msg.name || config.get<string>('agentName', '') || 'King';
                const agentRole = msg.role || config.get<string>('agentRole', '') || 'Lead';
                const sessionName = msg.sessionName || 'Untitled Session';
                const lanAccess = config.get<boolean>('lanAccess', true);
                const bindAddress = lanAccess ? '0.0.0.0' : '127.0.0.1';
                try {
                    const address = await sessionManager.startAsKing(agentName, agentRole, undefined, bindAddress);

                    // Auto-save session details to workspace
                    saveSessionFile(context, {
                        sessionName,
                        role: 'king',
                        address,
                        secret: sessionManager.getSessionSecret(),
                        apiToken: sessionManager.getApiToken(),
                        apiPort: sessionManager.getApiPort(),
                        agentName,
                        startedAt: new Date().toISOString()
                    });

                    sidebarProvider.postMessage({
                        type: 'session_started', isKing: true,
                        address, agentName, agentRole, sessionName
                    });

                    const action = await vscode.window.showInformationMessage(
                        `Gnana King "${sessionName}" at ${address}`,
                        'Copy Connection Info'
                    );
                    if (action === 'Copy Connection Info') {
                        const _secret = sessionManager.getSessionSecret();
                        const _apiToken = sessionManager.getApiToken();
                        const _apiPort = sessionManager.getApiPort();
                        await vscode.env.clipboard.writeText(
                            `Session: ${sessionName}\nAddress: ${address}\nSession Secret: ${_secret}\nAPI Token: ${_apiToken}\nAPI: http://127.0.0.1:${_apiPort}`
                        );
                        vscode.window.showInformationMessage('Connection info copied to clipboard!');
                    }
                } catch (err: any) {
                    sidebarProvider.postMessage({ type: 'error', text: err.message });
                }
                break;
            }

            case 'join_session': {
                const agentName = msg.name || config.get<string>('agentName', '') || 'Agent';
                const agentRole = msg.role || config.get<string>('agentRole', '') || 'Developer';
                if (!msg.host || !msg.port || !msg.secret) {
                    sidebarProvider.postMessage({ type: 'error', text: 'Enter King IP, port, and session secret.' });
                    return;
                }
                try {
                    await sessionManager.joinAsAgent(
                        agentName, agentRole, msg.host,
                        parseInt(msg.port, 10), msg.secret
                    );

                    // Auto-save session details
                    saveSessionFile(context, {
                        role: 'agent',
                        address: `${msg.host}:${msg.port}`,
                        agentName,
                        startedAt: new Date().toISOString()
                    });

                    sidebarProvider.postMessage({
                        type: 'session_started', isKing: false,
                        address: `${msg.host}:${msg.port}`,
                        agentName, agentRole
                    });
                } catch (err: any) {
                    sidebarProvider.postMessage({ type: 'error', text: err.message });
                }
                break;
            }

            case 'post_chat': {
                const apiKey = config.get<string>('anthropicApiKey', '');
                const session = sessionManager.getSession();
                
                // Record user message
                sessionManager.addChatEntry(session?.isKing ? 'king' : 'user', msg.content);

                // If API key is set, send to Claude for AI response
                if (apiKey) {
                    if (!kingAI) {
                        // Build team context into system prompt
                        const teamNames = (session?.team || []).map(m => `${m.name} (${m.role})`).join(', ');
                        const contextPrompt = KING_SYSTEM_PROMPT + 
                            `\n\nCurrent team: ${teamNames || 'No agents connected yet.'}` +
                            `\n\nWhen creating tasks, use this exact format so they auto-populate on the board:\nTASK: <title>\nOWNER: <agent name>\nDESCRIPTION: <what to do>\n\nCreate one TASK block per task.`;
                        kingAI = new AIService(apiKey, contextPrompt);
                    }
                    try {
                        const response = await kingAI.chat(msg.content);
                        sessionManager.addChatEntry('assistant', response);

                        // Auto-parse tasks from AI response and add to board
                        const parsedTasks = AIService.parseTasks(response);
                        if (parsedTasks.length > 0) {
                            for (const t of parsedTasks) {
                                sessionManager.addTask({
                                    title: t.title,
                                    owner: t.owner,
                                    status: 'todo',
                                    description: t.description
                                });
                            }
                            sessionManager.addChatEntry('assistant', 
                                `📋 Auto-created ${parsedTasks.length} task(s) on the board.`);
                        }
                    } catch (err: any) {
                        sessionManager.addChatEntry('assistant', 
                            `❌ AI Error: ${err.message}\n\nCheck your API key in Settings → gnana.anthropicApiKey`);
                    }
                } else {
                    sessionManager.addChatEntry('assistant',
                        '⚠️ No Anthropic API key set.\n\nTo enable AI orchestration:\n1. Go to Settings (Ctrl+,)\n2. Search "gnana.anthropicApiKey"\n3. Paste your key from https://console.anthropic.com\n\nThe King AI will then auto-divide tasks, assign to agents, and review work.');
                }
                break;
            }

            case 'send_agent_update':
                sessionManager.sendAgentUpdate(msg.text, msg.updateType || 'status', msg.taskId);
                break;

            case 'team_chat': {
                const sender = sessionManager.getSession()?.agentName || 'Unknown';
                const chatMsg = { sender, text: msg.text, timestamp: Date.now() };
                // Show locally
                sidebarProvider.postMessage({ type: 'team_chat_msg', ...chatMsg });
                // Broadcast to all peers
                sessionManager.broadcastTeamChat(chatMsg);
                break;
            }

            case 'ai_chat': {
                const apiKey = config.get<string>('anthropicApiKey', '');
                if (!apiKey) {
                    sidebarProvider.postMessage({
                        type: 'ai_response',
                        text: '🔑 Set your Anthropic API key to use AI.\n\n1. Go to Settings (Ctrl+,)\n2. Search "gnana.anthropicApiKey"\n3. Paste your key from https://console.anthropic.com\n\nFree tier gives you enough for testing.'
                    });
                    break;
                }

                if (!agentAI) {
                    const session = sessionManager.getSession();
                    const agentPrompt = `You are a helpful AI coding assistant inside Gnana, a collaborative coding tool. ` +
                        `You are helping ${session?.agentName || 'a developer'} (${session?.agentRole || 'Developer'}). ` +
                        `Be concise, practical, and give direct answers. When asked about code, provide working examples.`;
                    agentAI = new AIService(apiKey, agentPrompt);
                }

                try {
                    const response = await agentAI.chat(msg.text);
                    sidebarProvider.postMessage({ type: 'ai_response', text: response });
                } catch (err: any) {
                    sidebarProvider.postMessage({ type: 'ai_response', text: '❌ ' + (err.message || String(err)) });
                }
                break;
            }

            case 'update_task_status':
                sessionManager.updateTaskStatus(msg.taskId, msg.status);
                break;

            case 'add_task':
                sessionManager.addTask({
                    title: msg.title, owner: msg.owner || '',
                    status: 'todo', description: msg.description || ''
                });
                break;

            case 'disconnect':
                if (ngrokTunnel) { ngrokTunnel.stop(); ngrokTunnel = null; }
                sessionManager.disconnect();
                sidebarProvider.syncState(null);
                sidebarProvider.postMessage({ type: 'tunnel_status', status: 'disconnected' });
                vscode.window.showInformationMessage('Disconnected from Gnana.');
                break;

            case 'open_settings':
                vscode.commands.executeCommand('workbench.action.openSettings', 'gnana');
                break;

            case 'copy_info': {
                const apiPort = sessionManager.getApiPort();
                const apiToken = sessionManager.getApiToken();
                const sessionSecret = sessionManager.getSessionSecret();
                const session = sessionManager.getSession();
                const tunnelUrl = ngrokTunnel?.getPublicUrl();
                const lines = [
                    `Address: ${session?.serverAddress || 'N/A'}`,
                    ...(tunnelUrl ? [`Public (ngrok): ${tunnelUrl}`] : []),
                    `Session Secret: ${sessionSecret || 'N/A'}`,
                    `API: http://127.0.0.1:${apiPort}`,
                    `API Token: ${apiToken || 'N/A'}`
                ];
                await vscode.env.clipboard.writeText(lines.join('\n'));
                vscode.window.showInformationMessage('Connection info copied!');
                break;
            }

            case 'start_tunnel': {
                if (!sessionManager.isActive()) {
                    sidebarProvider.postMessage({ type: 'error', text: 'Start a session first.' });
                    break;
                }
                const p2pPort = sessionManager.getP2PPort();
                if (!p2pPort) {
                    sidebarProvider.postMessage({ type: 'error', text: 'No P2P port available.' });
                    break;
                }
                try {
                    ngrokTunnel = new NgrokTunnel(p2pPort);
                    const ngrokToken = config.get<string>('ngrokAuthToken', '');
                    sidebarProvider.postMessage({ type: 'tunnel_status', status: 'connecting' });
                    const publicUrl = await ngrokTunnel.start(ngrokToken || undefined);
                    sidebarProvider.postMessage({ type: 'tunnel_status', status: 'connected', url: publicUrl });
                    vscode.window.showInformationMessage(`Tunnel active: ${publicUrl}`);
                } catch (err: any) {
                    ngrokTunnel = null;
                    sidebarProvider.postMessage({ type: 'tunnel_status', status: 'error', error: err.message });
                    vscode.window.showErrorMessage(err.message);
                }
                break;
            }

            case 'stop_tunnel': {
                if (ngrokTunnel) {
                    ngrokTunnel.stop();
                    ngrokTunnel = null;
                    sidebarProvider.postMessage({ type: 'tunnel_status', status: 'disconnected' });
                }
                break;
            }
        }
    });

    const provider = vscode.window.registerWebviewViewProvider(
        GnanaSidebarProvider.viewType, sidebarProvider,
        { webviewOptions: { retainContextWhenHidden: true } }
    );
    context.subscriptions.push(provider);

    context.subscriptions.push(
        vscode.commands.registerCommand('gnana.openPanel', () => {
            vscode.commands.executeCommand('gnana.sidebarView.focus');
        }),
        vscode.commands.registerCommand('gnana.startSession', async () => {
            const config = vscode.workspace.getConfiguration('gnana');
            const name = config.get<string>('agentName', '') || 'King';
            const role = config.get<string>('agentRole', '') || 'Lead';
            const lanAccess = config.get<boolean>('lanAccess', true);
            const bindAddress = lanAccess ? '0.0.0.0' : '127.0.0.1';
            const addr = await sessionManager.startAsKing(name, role, undefined, bindAddress);
            sidebarProvider.postMessage({ type: 'session_started', isKing: true, address: addr, agentName: name, agentRole: role });
        }),
        vscode.commands.registerCommand('gnana.joinSession', async () => {
            const config = vscode.workspace.getConfiguration('gnana');
            const name = config.get<string>('agentName', '') || 'Agent';
            const role = config.get<string>('agentRole', '') || 'Developer';
            const input = await vscode.window.showInputBox({ prompt: 'King address (IP:PORT)', placeHolder: '192.168.1.10:9777' });
            if (!input) return;
            const secret = await vscode.window.showInputBox({ prompt: 'Session secret', placeHolder: 'Paste the session secret from King' });
            if (!secret) return;
            const [host, portStr] = input.split(':');
            await sessionManager.joinAsAgent(name, role, host, parseInt(portStr, 10) || 9777, secret);
            sidebarProvider.postMessage({ type: 'session_started', isKing: false, address: input, agentName: name, agentRole: role });
        })
    );
}

export function deactivate() {
    if (ngrokTunnel) { ngrokTunnel.stop(); ngrokTunnel = null; }
    if (sessionManager) sessionManager.disconnect();
}

/**
 * Auto-save session details to .gnana/session.json in the workspace.
 */
async function saveSessionFile(context: vscode.ExtensionContext, data: Record<string, any>): Promise<void> {
    try {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || !folders.length) return;

        const gnanaDir = vscode.Uri.joinPath(folders[0].uri, '.gnana');
        const sessionFile = vscode.Uri.joinPath(gnanaDir, 'session.json');

        // Create .gnana directory
        try { await vscode.workspace.fs.createDirectory(gnanaDir); } catch (_) { /* exists */ }

        // Write session data
        const content = JSON.stringify(data, null, 2);
        await vscode.workspace.fs.writeFile(sessionFile, Buffer.from(content, 'utf-8'));

        // Add .gnana to .gitignore if not already there
        const gitignorePath = vscode.Uri.joinPath(folders[0].uri, '.gitignore');
        try {
            const existing = Buffer.from(await vscode.workspace.fs.readFile(gitignorePath)).toString('utf-8');
            if (!existing.includes('.gnana')) {
                await vscode.workspace.fs.writeFile(gitignorePath, Buffer.from(existing + '\n.gnana/\n', 'utf-8'));
            }
        } catch (_) {
            // No .gitignore, create one
            await vscode.workspace.fs.writeFile(gitignorePath, Buffer.from('.gnana/\n', 'utf-8'));
        }
    } catch (_) { /* non-critical */ }
}
