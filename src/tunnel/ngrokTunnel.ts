import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';

/**
 * Manages a bore TCP tunnel for internet-accessible P2P connections.
 * bore.pub is free, requires no signup, no tokens, no accounts.
 * https://github.com/ekzhang/bore
 */
export class NgrokTunnel {
    private process: ChildProcess | null = null;
    private publicUrl: string | null = null;
    private localPort: number;

    constructor(localPort: number) {
        this.localPort = localPort;
    }

    /**
     * Start a bore TCP tunnel.
     * @returns The public tunnel URL (e.g. "bore.pub:12345")
     */
    async start(_authToken?: string): Promise<string> {
        if (this.publicUrl) return this.publicUrl;

        // Try bundled bore first, then system PATH
        const borePaths = [
            path.join(__dirname, '..', '..', 'tools', 'bore.exe'),
            'bore'
        ];

        return new Promise((resolve, reject) => {
            let started = false;

            const tryNext = (index: number) => {
                if (index >= borePaths.length) {
                    reject(new Error(
                        'bore not found. Download it from https://github.com/ekzhang/bore/releases ' +
                        'and place bore.exe in the extension tools/ folder, or add it to PATH.'
                    ));
                    return;
                }

                const borePath = borePaths[index];
                const args = ['local', this.localPort.toString(), '--to', 'bore.pub'];

                try {
                    this.process = spawn(borePath, args, {
                        stdio: ['pipe', 'pipe', 'pipe'],
                        shell: false
                    });
                } catch (_err) {
                    tryNext(index + 1);
                    return;
                }

                const timeout = setTimeout(() => {
                    if (!started) {
                        reject(new Error('bore tunnel timed out after 15s. Check your internet connection.'));
                        this.stop();
                    }
                }, 15000);

                this.process.stdout?.on('data', (data: Buffer) => {
                    const line = data.toString();
                    // bore outputs: "listening at bore.pub:PORT"
                    const match = line.match(/bore\.pub:(\d+)/);
                    if (match && !started) {
                        started = true;
                        clearTimeout(timeout);
                        this.publicUrl = `bore.pub:${match[1]}`;
                        resolve(this.publicUrl);
                    }
                });

                this.process.stderr?.on('data', (data: Buffer) => {
                    const msg = data.toString();
                    // bore also outputs the URL to stderr sometimes
                    const match = msg.match(/bore\.pub:(\d+)/);
                    if (match && !started) {
                        started = true;
                        clearTimeout(timeout);
                        this.publicUrl = `bore.pub:${match[1]}`;
                        resolve(this.publicUrl);
                    }
                });

                this.process.on('error', (_err) => {
                    clearTimeout(timeout);
                    if (!started) {
                        // Try next path
                        tryNext(index + 1);
                    }
                });

                this.process.on('close', (code) => {
                    if (!started) {
                        clearTimeout(timeout);
                        // If exited quickly, try next path
                        if (index + 1 < borePaths.length) {
                            tryNext(index + 1);
                        } else {
                            reject(new Error(`bore exited with code ${code}. Make sure bore.exe is available.`));
                        }
                    }
                    this.publicUrl = null;
                });
            };

            tryNext(0);
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
