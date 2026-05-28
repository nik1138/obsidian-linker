import { LlmMessage, LlmOptions, LlmResponse, LlmClient, LLM_MODEL, LLM_DEFAULT_TIMEOUT, LLM_DEFAULT_TEMPERATURE, LLM_MAX_TOKENS } from "./types.js";

/** Custom error for LLM API failures */
export class LlmApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = "LlmApiError";
  }
}

/** Token bucket rate limiter */
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per second

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async consume(): Promise<void> {
    this.refill();

    while (this.tokens < 1) {
      // Wait for at least one token
      const deficit = 1 - this.tokens;
      const waitMs = (deficit / this.refillRate) * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitMs + 10));
      this.refill();
    }

    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // seconds
    const newTokens = elapsed * this.refillRate;

    if (newTokens > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + newTokens);
      this.lastRefill = now;
    }
  }
}

/** StepFun API client (OpenAI-compatible) */
export class StepFunClient implements LlmClient {
  private baseUrl: string;
  private apiKey: string;
  private rateLimiter: RateLimiter;
  private maxRetries: number;

  constructor(options: { apiKey?: string; baseUrl?: string; maxRetries?: number } = {}) {
    this.baseUrl = options.baseUrl || "https://api.stepfun.com/v1";
    this.apiKey = options.apiKey || process.env['STEPFUN_API_KEY'] || "";
    this.maxRetries = options.maxRetries || 3;

    // Rate limit: 60 RPM = 1 token per second (conservative)
    this.rateLimiter = new RateLimiter(60, 1);
  }

  /** Check if API key is configured */
  hasApiKey(): boolean {
    return this.apiKey.length > 0;
  }

  /** Health check — ping the API */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /** Send a chat completion request with retry logic */
  async chat(messages: LlmMessage[], options: LlmOptions = {}): Promise<LlmResponse> {
    const {
      temperature = LLM_DEFAULT_TEMPERATURE,
      maxTokens = LLM_MAX_TOKENS,
      responseFormat,
      timeout = LLM_DEFAULT_TIMEOUT,
    } = options;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Wait for rate limiter
        await this.rateLimiter.consume();

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: LLM_MODEL,
            messages,
            temperature,
            max_tokens: maxTokens,
            response_format: responseFormat ? { type: responseFormat } : undefined,
          }),
          signal: AbortSignal.timeout(timeout),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

          try {
            const errorJson = JSON.parse(errorBody);
            errorMessage = errorJson.error?.message || errorJson.message || errorBody;
          } catch {
            errorMessage = errorBody;
          }

          const error = new LlmApiError(response.status, errorMessage, { body: errorBody });

          // Retry on rate limit (429) and server errors (5xx)
          if (response.status === 429 || response.status >= 500) {
            lastError = error;

            // Exponential backoff: 2^attempt * 1000ms, capped at 10s
            const backoffMs = Math.min(10000, Math.pow(2, attempt) * 1000);
            console.warn(`LLM API error (attempt ${attempt}/${this.maxRetries}), retrying in ${backoffMs}ms:`, errorMessage);
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }

          throw error;
        }

        const data = await response.json() as {
          choices: Array<{
            message: { content: string };
            finish_reason: string;
          }>;
          usage: {
            prompt_tokens: number;
            completion_tokens: number;
          };
        };

        return {
          content: data.choices[0].message.content,
          finishReason: data.choices[0].finish_reason as "stop" | "length" | "error",
          usage: {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
          },
        };
      } catch (error) {
        // Network errors or other failures
        if (error instanceof LlmApiError) {
          lastError = error;
          continue; // Retry handled above
        }

        // Non-retryable error
        throw error;
      }
    }

    throw lastError || new Error("Max retries exceeded");
  }
}

/** Connection analyzer with online/offline detection */
export class ConnectionAnalyzer {
  private llmClient: StepFunClient;
  private isOnline: boolean = true;
  private lastHealthCheck: number = 0;
  private healthCheckInterval: number;
  private healthCheckPromise: Promise<boolean> | null = null;

  constructor(llmClient: StepFunClient, healthCheckInterval: number = 60000) {
    this.llmClient = llmClient;
    this.healthCheckInterval = healthCheckInterval;
  }

  /** Check connectivity (cached) */
  async checkConnectivity(): Promise<void> {
    const now = Date.now();
    if (now - this.lastHealthCheck < this.healthCheckInterval && this.healthCheckPromise) {
      this.isOnline = await this.healthCheckPromise;
      return;
    }

    this.healthCheckPromise = (async () => {
      try {
        const online = await this.llmClient.healthCheck();
        this.isOnline = online;
        this.lastHealthCheck = Date.now();
        return online;
      } catch {
        this.isOnline = false;
        this.lastHealthCheck = Date.now();
        return false;
      }
    })();

    this.isOnline = await this.healthCheckPromise;
  }

  /** Get online status */
  getOnlineStatus(): boolean {
    return this.isOnline;
  }

  /** Force health check */
  async forceHealthCheck(): Promise<boolean> {
    this.lastHealthCheck = 0;
    await this.checkConnectivity();
    return this.isOnline;
  }
}