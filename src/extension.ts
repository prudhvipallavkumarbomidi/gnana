import * as vscode from 'vscode';
import { SessionManager } from './agents/sessionManager';
import { GnanaSidebarProvider } from './ui/sidebarProvider';
import { NgrokTunnel } from './tunnel/ngrokTunnel';

let sessionManager: SessionManager;
let sidebarProvider: GnanaSidebarProvider;
let ngrokTunnel: NgrokTunnel | null = null;

export function activate(context: vscode.ExtensionContext) {
    sessionManager = new SessionManager(() => {
        const session = sessionManager.getSession();
        sidebarProvider.syncState(session);
    });

    sidebarProvider = new GnanaSidebarProvider(context.extensionUri, async (msg: any) => {
        const config = vscode.workspace.getConfiguration('gnana');

        switch (msg.type) {
            case 'start_king': {
                const agentName = config.get<string>('agentName', '') || 'King';
                const agentRole = config.get<string>('agentRole', '') || 'Lead';
                const lanAccess = config.get<boolean>('lanAccess', true);
                const bindAddress = lanAccess ? '0.0.0.0' : '127.0.0.1';
                try {
                    const address = await sessionManager.startAsKing(agentName, agentRole, undefined, bindAddress);

                    sidebarProvider.postMessage({
                        type: 'session_started', isKing: true,
                        address, agentName, agentRole
                    });

                    const action = await vscode.window.showInformationMessage(
                        `Gnana King at ${address}`,
                        'Copy Connection Info'
                    );
                    if (action === 'Copy Connection Info') {
                        const _apiPort = sessionManager.getApiPort();
                        const _apiToken = sessionManager.getApiToken();
                        const _secret = sessionManager.getSessionSecret();
                        await vscode.env.clipboard.writeText(
                            `Address: ${address}\nSession Secret: ${_secret}\nAPI Token: ${_apiToken}\nAPI: http://127.0.0.1:${_apiPort}`
                        );
                        vscode.window.showInformationMessage('Connection info copied to clipboard!');
                    }
                } catch (err: any) {
                    sidebarProvider.postMessage({ type: 'error', text: err.message });
                }
                break;
            }

            case 'join_session': {
                const agentName = config.get<string>('agentName', '') || 'Agent';
                const agentRole = config.get<string>('agentRole', '') || 'Developer';
                if (!msg.host || !msg.port || !msg.secret) {
                    sidebarProvider.postMessage({ type: 'error', text: 'Enter King IP, port, and session secret.' });
                    return;
                }
                try {
                    await sessionManager.joinAsAgent(
                        agentName, agentRole, msg.host,
                        parseInt(msg.port, 10), msg.secret
                    );
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
                // Route through SessionManager for bounded logs + truncation
                sessionManager.addChatEntry(
                    sessionManager.getSession()?.isKing ? 'king' : 'user',
                    msg.content
                );
                break;
            }

            case 'send_agent_update':
                sessionManager.sendAgentUpdate(msg.text, msg.updateType || 'status', msg.taskId);
                break;

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
