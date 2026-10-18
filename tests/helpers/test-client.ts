/**
 * Opaque-box HTTP test client for E2E testing of Khui AI API endpoints.
 * Utilizes native Node fetch (Node 18+) for HTTP operations.
 */

export interface SSEChunkResult {
  fullText: string;
  chunks: string[];
  isDone: boolean;
  events: Array<{ event?: string; data: string }>;
}

export class TestClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.TEST_BASE_URL || 'http://localhost:3000';
  }

  public setToken(token: string | null): void {
    this.token = token;
  }

  public getToken(): string | null {
    return this.token;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public async request(path: string, options: RequestInit = {}): Promise<Response> {
    const url = path.startsWith('http://') || path.startsWith('https://')
      ? path
      : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

    const headers = new Headers(options.headers || {});

    if (this.token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    let body = options.body;
    if (
      body !== undefined &&
      typeof body === 'object' &&
      !(body instanceof FormData) &&
      !(body instanceof ArrayBuffer) &&
      !(body instanceof URLSearchParams) &&
      !(body instanceof ReadableStream)
    ) {
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      body = JSON.stringify(body);
    }

    return fetch(url, {
      ...options,
      headers,
      body,
    });
  }

  public async get(path: string, headers?: Record<string, string>): Promise<Response> {
    return this.request(path, { method: 'GET', headers });
  }

  public async post(path: string, body?: any, headers?: Record<string, string>): Promise<Response> {
    return this.request(path, { method: 'POST', body, headers });
  }

  /** Legacy regression scenarios need an actually reviewed public fixture.
   * Approval uses the real moderation route; this never grants users approval rights.
   * The dedicated review suite separately checks pending/denied/stale transitions.
   */
  public async createReviewedFixture(body:any):Promise<Response>{
    const requested=body.isPublic??body.is_public??true;
    const response=await this.post('/api/characters',{copyrightStatement:'Automated test fixture; original text, test image URL.',...body,...(body.isPublic===undefined&&body.is_public===undefined?{isPublic:true}:{})});
    if(!response.ok||requested!==true)return response;
    const payload=await response.clone().json();const role=payload.character||payload;
    const login=await fetch(this.baseUrl+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.TEST_REVIEWER_EMAIL||'reviewer@example.invalid',password:process.env.TEST_REVIEWER_PASSWORD||'ReviewTest123!'})});
    if(!login.ok)throw Error('Reviewed fixture requires an isolated test reviewer account configured in MODERATOR_USER_IDS.');
    const {token}=await login.json();
    const approval=await fetch(this.baseUrl+'/api/admin/moderation/characters/'+role.id,{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({status:'APPROVED',reason:'Regression fixture approval',updatedAt:role.updatedAt})});
    if(!approval.ok)throw Error('Fixture approval failed: '+await approval.text());
    const refreshed=await this.get('/api/characters/'+role.id);const data=await refreshed.json();
    return new Response(JSON.stringify({character:data.character}),{status:response.status,headers:{'Content-Type':'application/json'}});
  }

  public async put(path: string, body?: any, headers?: Record<string, string>): Promise<Response> {
    return this.request(path, { method: 'PUT', body, headers });
  }

  public async patch(path: string, body?: any, headers?: Record<string, string>): Promise<Response> {
    return this.request(path, { method: 'PATCH', body, headers });
  }

  /**
   * POST to a streaming endpoint and drain it. A chat turn is only finished once the
   * stream closes — the assistant message is written in the stream's `finally` — so a test
   * that reads the thread without draining first races the write.
   */
  public async postSSE(path: string, body?: any): Promise<{ status: number; text: string }> {
    const response = await this.post(path, body);
    if (!response.body) return { status: response.status, text: await response.text() };
    const result = await TestClient.readSSEStream(response);
    return { status: response.status, text: result.fullText };
  }

  public async delete(path: string, headers?: Record<string, string>): Promise<Response> {
    return this.request(path, { method: 'DELETE', headers });
  }

  /**
   * A Response body can only be read once, but tests legitimately inspect the
   * same response more than once (e.g. probing for both an array and a wrapper
   * object). Cache the parsed payload per Response so repeat calls return it
   * instead of throwing "Body has already been read".
   */
  private static readonly parsedBodies = new WeakMap<Response, Promise<unknown>>();

  public async json<T = any>(response: Response): Promise<T> {
    const cached = TestClient.parsedBodies.get(response);
    if (cached) return cached as Promise<T>;

    const parsed = (async () => {
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Failed to parse JSON response (Status ${response.status}): ${text.substring(0, 200)}`);
      }
    })();

    TestClient.parsedBodies.set(response, parsed);
    return parsed as Promise<T>;
  }

  /**
   * Reads and parses a Server-Sent Events (SSE) stream from a response.
   */
  public static async readSSEStream(
    response: Response,
    onChunk?: (chunk: string) => void
  ): Promise<SSEChunkResult> {
    if (!response.body) {
      throw new Error('Response body is null. Cannot read SSE stream.');
    }

    const chunks: string[] = [];
    const events: Array<{ event?: string; data: string }> = [];
    let fullText = '';
    let isDone = false;

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent: string | undefined = undefined;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.substring(6).trim();
        } else if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.substring(5).trim();
          if (dataStr === '[DONE]') {
            isDone = true;
            events.push({ event: currentEvent, data: '[DONE]' });
            break;
          }

          let chunkText = dataStr;
          try {
            const parsed = JSON.parse(dataStr);
            if (typeof parsed === 'object' && parsed !== null) {
              chunkText = parsed.content || parsed.text || parsed.delta || dataStr;
            }
          } catch {
            // Keep raw data string if not JSON
          }

          chunks.push(chunkText);
          fullText += chunkText;
          events.push({ event: currentEvent, data: dataStr });

          if (onChunk) {
            onChunk(chunkText);
          }
        }
      }
    }

    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data:')) {
        const dataStr = trimmed.substring(5).trim();
        if (dataStr === '[DONE]') {
          isDone = true;
        } else {
          chunks.push(dataStr);
          fullText += dataStr;
        }
      }
    }

    return {
      fullText,
      chunks,
      isDone,
      events,
    };
  }
}
