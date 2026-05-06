import * as https from 'https';

/**
 * AI Service — makes direct API calls to Claude for autonomous task orchestration.
 * Uses Anthropic's Messages API.
 */
export class AIService {
    private apiKey: string;
    private model: string;
    private systemPrompt: string;
    private history: { role: 'user' | 'assistant'; content: string }[] = [];

    constructor(apiKey: string, systemPrompt: string, model?: string) {
        this.apiKey = apiKey;
        this.systemPrompt = systemPrompt;
        this.model = model || 'claude-sonnet-4-20250514';
    }

    setApiKey(key: string): void {
        this.apiKey = key;
    }

    hasApiKey(): boolean {
        return !!this.apiKey && this.apiKey.length > 10;
    }

    /**
     * Send a message and get AI response.
     * Maintains conversation history for context.
     */
    async chat(userMessage: string, onChunk?: (chunk: string) => void): Promise<string> {
        if (!this.apiKey) {
            throw new Error('No API key. Set your Anthropic API key in Settings → gnana.anthropicApiKey');
        }

        this.history.push({ role: 'user', content: userMessage });

        const body = JSON.stringify({
            model: this.model,
            max_tokens: 4096,
            system: this.systemPrompt,
            messages: this.history.slice(-20) // keep last 20 messages for context
        });

        const response = await this.makeRequest(body);
        const text = response.content?.[0]?.text || 'No response from AI.';

        this.history.push({ role: 'assistant', content: text });

        return text;
    }

    /**
     * One-shot prompt (no history).
     */
    async prompt(systemPrompt: string, userMessage: string): Promise<string> {
        if (!this.apiKey) {
            throw new Error('No API key configured.');
        }

        const body = JSON.stringify({
            model: this.model,
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }]
        });

        const response = await this.makeRequest(body);
        return response.content?.[0]?.text || 'No response.';
    }

    private makeRequest(body: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.anthropic.com',
                path: '/v1/messages',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01'
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.error) {
                            reject(new Error(parsed.error.message || 'API error'));
                        } else {
                            resolve(parsed);
                        }
                    } catch (e) {
                        reject(new Error('Invalid API response'));
                    }
                });
            });

            req.on('error', (err) => reject(err));
            req.write(body);
            req.end();
        });
    }

    /**
     * Parse AI response for task blocks and return structured tasks.
     * Looks for patterns like:
     *   TASK: Title
     *   OWNER: AgentName
     *   DESCRIPTION: What to do
     */
    static parseTasks(text: string): { title: string; owner: string; description: string }[] {
        const tasks: { title: string; owner: string; description: string }[] = [];
        
        // Pattern 1: TASK: / OWNER: / DESCRIPTION: blocks
        const taskPattern = /TASK:\s*(.+?)(?:\n|$)[\s\S]*?OWNER:\s*(.+?)(?:\n|$)[\s\S]*?(?:DESCRIPTION|SCOPE|DETAILS):\s*([\s\S]*?)(?=TASK:|$)/gi;
        let match;
        while ((match = taskPattern.exec(text)) !== null) {
            tasks.push({
                title: match[1].trim(),
                owner: match[2].trim(),
                description: match[3].trim().substring(0, 500)
            });
        }

        // Pattern 2: Numbered tasks like "1. [Frontend] Build login page - assigned to Alice"
        if (tasks.length === 0) {
            const linePattern = /^\d+[\.\)]\s*(?:\[([^\]]+)\]\s*)?(.+?)(?:\s*[-–—]\s*(?:assigned to|owner:?)\s*(.+))?$/gim;
            while ((match = linePattern.exec(text)) !== null) {
                tasks.push({
                    title: match[2].trim(),
                    owner: (match[3] || match[1] || '').trim(),
                    description: ''
                });
            }
        }

        return tasks;
    }

    getHistory(): { role: string; content: string }[] {
        return [...this.history];
    }

    clearHistory(): void {
        this.history = [];
    }
}
