import { ChildProcess, spawn } from 'child_process';
import * as http from 'http';

/**
 * Manages an ngrok TCP tunnel for internet-accessible P2P connections.
 * Uses the ngrok CLI (must be installed globally).
 */
export class NgrokTunnel {
    private process: ChildProcess | null = null;
    private publicUrl: string | null = null;
    private localPort: number;

    constructor(localPort: number) {
        this.localPort = localPort;
    }

    /**
     * Start an ngrok TCP tunnel.
     * @param authToken Optional ngrok auth token (can also be pre-configured via `ngrok config`)
     * @returns The public tunnel URL (e.g. "0.tcp.ngrok.io:12345")
     */
    async start(authToken?: string): Promise<string> {
        if (this.publicUrl) return this.publicUrl;

        // If auth token provided, set it first
        if (authToken) {
            await this.runNgrokCommand(['config', 'add-authtoken', authToken]);
        }

        // Start ngrok TCP tunnel
        return new Promise((resolve, reject) => {
            const args = ['tcp', this.localPort.toString(), '--log', 'stdout', '--log-format', 'json'];
            
            try {
                this.process = spawn('ngrok', args, {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    shell: true
                });
            } catch (err) {
                reject(new Error('ngrok is not installed. Install it from https://ngrok.com/download'));
                return;
            }

            let started = false;
            const timeout = setTimeout(() => {
                if (!started) {
                    // Try fetching from ngrok API instead
                    this.fetchTunnelUrl()
                        .then(url => {
                            started = true;
                            this.publicUrl = url;
                            resolve(url);
                        })
                        .catch(() => reject(new Error('ngrok tunnel timed out. Check your ngrok auth token.')));
                }
            }, 5000);

            this.process.stdout?.on('data', (data: Buffer) => {
                const line = data.toString();
                try {
                    // ngrok JSON log has a line with "url" when tunnel is established
                    const entries = line.split('\n').filter(l => l.trim());
                    for (const entry of entries) {
                        try {
                            const log = JSON.parse(entry);
                            if (log.url && log.url.startsWith('tcp://')) {
                                started = true;
                                clearTimeout(timeout);
                                this.publicUrl = log.url.replace('tcp://', '');
                                resolve(this.publicUrl);
                                return;
                            }
                        } catch (_e) { /* not json */ }
                    }
                } catch (_e) { /* ignore */ }
            });

            this.process.stderr?.on('data', (data: Buffer) => {
                const msg = data.toString();
                if (msg.includes('ERR_NGROK_') || msg.includes('authentication failed')) {
                    started = true;
                    clearTimeout(timeout);
                    reject(new Error('ngrok error: ' + msg.trim().substring(0, 200)));
                }
            });

            this.process.on('error', (err) => {
                clearTimeout(timeout);
                if ((err as any).code === 'ENOENT') {
                    reject(new Error('ngrok is not installed. Install it from https://ngrok.com/download'));
                } else {
                    reject(err);
                }
            });

            this.process.on('close', (code) => {
                if (!started) {
                    clearTimeout(timeout);
                    reject(new Error(`ngrok exited with code ${code}`));
                }
                this.publicUrl = null;
            });
        });
    }

    /**
     * Fetch tunnel URL from ngrok's local API (http://127.0.0.1:4040)
     */
    private fetchTunnelUrl(): Promise<string> {
        return new Promise((resolve, reject) => {
            const req = http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
                let body = '';
                res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                res.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        const tunnel = data.tunnels?.find((t: any) => t.proto === 'tcp');
                        if (tunnel && tunnel.public_url) {
                            resolve(tunnel.public_url.replace('tcp://', ''));
                        } else {
                            reject(new Error('No TCP tunnel found'));
                        }
                    } catch (_e) {
                        reject(new Error('Failed to parse ngrok API response'));
                    }
                });
            });
            req.on('error', (err) => reject(err));
            req.setTimeout(3000, () => {
                req.destroy();
                reject(new Error('ngrok API timeout'));
            });
        });
    }

    /**
     * Run a one-shot ngrok command (e.g. config add-authtoken)
     */
    private runNgrokCommand(args: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const proc = spawn('ngrok', args, { shell: true });
            proc.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`ngrok ${args.join(' ')} failed with code ${code}`));
            });
            proc.on('error', (err) => reject(err));
        });
    }

    /**
     * Check if ngrok CLI is installed.
     */
    static async isInstalled(): Promise<boolean> {
        return new Promise((resolve) => {
            const proc = spawn('ngrok', ['version'], { shell: true });
            proc.on('close', (code) => resolve(code === 0));
            proc.on('error', () => resolve(false));
        });
    }

    getPublicUrl(): string | null {
        return this.publicUrl;
    }

    isRunning(): boolean {
        return this.process !== null && !this.process.killed;
    }

    stop(): void {
        if (this.process && !this.process.killed) {
            this.process.kill();
        }
        this.process = null;
        this.publicUrl = null;
    }
}
