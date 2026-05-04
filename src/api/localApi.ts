import * as http from 'http';
import * as crypto from 'crypto';

type RequestHandler = (body: any) => Promise<any>;

interface Route {
    method: string;
    handler: RequestHandler;
}

const MAX_BODY_SIZE = 64 * 1024; // 64 KB max request body

export class LocalApi {
    private server: http.Server | null = null;
    private port: number;
    private handlers: Map<string, Route> = new Map();
    private sessionToken: string;

    constructor(port: number = 9778) {
        this.port = port;
        // Generate a random session token — required on every request
        this.sessionToken = crypto.randomBytes(24).toString('hex');
    }

    /**
     * Returns the session token that must be passed as Authorization: Bearer <token>
     */
    getToken(): string {
        return this.sessionToken;
    }

    route(method: string, path: string, handler: RequestHandler): void {
        this.handlers.set(`${method.toUpperCase()} ${path}`, { method: method.toUpperCase(), handler });
    }

    async start(): Promise<number> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer(async (req, res) => {
                // No CORS — localhost only, no browser access needed
                res.setHeader('Content-Type', 'application/json');

                if (req.method === 'OPTIONS') {
                    res.writeHead(204);
                    res.end();
                    return;
                }

                // Auth check: require Bearer token on all requests
                const authHeader = req.headers['authorization'] || '';
                const token = authHeader.startsWith('Bearer ')
                    ? authHeader.slice(7).trim()
                    : (req.headers['x-gnana-token'] as string || '');

                if (token !== this.sessionToken) {
                    res.writeHead(401);
                    res.end(JSON.stringify({ error: 'Unauthorized. Provide Authorization: Bearer <token> or X-Gnana-Token header.' }));
                    return;
                }

                const key = `${req.method} ${req.url}`;
                const route = this.handlers.get(key);

                if (!route) {
                    res.writeHead(404);
                    res.end(JSON.stringify({
                        error: 'Not found',
                        path: req.url,
                        availableRoutes: Array.from(this.handlers.keys())
                    }));
                    return;
                }

                try {
                    let body: any = {};
                    if (req.method === 'POST') {
                        body = await this.readBody(req);
                    }
                    const result = await route.handler(body);
                    res.writeHead(200);
                    res.end(JSON.stringify(result, null, 2));
                } catch (err: any) {
                    const status = err.statusCode || 500;
                    res.writeHead(status);
                    res.end(JSON.stringify({ error: err.message || 'Internal error' }));
                }
            });

            this.server.on('error', (err: any) => {
                if (err.code === 'EADDRINUSE') {
                    this.port++;
                    this.server!.listen(this.port, '127.0.0.1');
                } else {
                    reject(err);
                }
            });

            this.server.listen(this.port, '127.0.0.1', () => {
                resolve(this.port);
            });
        });
    }

    private readBody(req: http.IncomingMessage): Promise<any> {
        return new Promise((resolve, reject) => {
            let data = '';
            let size = 0;

            req.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > MAX_BODY_SIZE) {
                    req.destroy();
                    const err: any = new Error(`Request body too large (max ${MAX_BODY_SIZE} bytes)`);
                    err.statusCode = 413;
                    reject(err);
                    return;
                }
                data += chunk.toString();
            });

            req.on('end', () => {
                try {
                    resolve(data ? JSON.parse(data) : {});
                } catch (_e) {
                    const err: any = new Error('Invalid JSON body');
                    err.statusCode = 400;
                    reject(err);
                }
            });

            req.on('error', reject);
        });
    }

    getPort(): number {
        return this.port;
    }

    stop(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}

export function validationError(message: string): Error {
    const err: any = new Error(message);
    err.statusCode = 400;
    return err;
}
