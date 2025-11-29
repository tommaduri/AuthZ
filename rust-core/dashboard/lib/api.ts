// API client utilities for Phase 5 dashboard

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080';

export interface Vertex {
  id: string;
  timestamp: number;
  parents?: string[];
  data?: any;
  signature?: string;
  confirmed?: boolean;
}

export interface EncryptResponse {
  ciphertext: string;
  algorithm: string;
}

export interface DecryptResponse {
  plaintext: string;
}

export interface Secret {
  key: string;
  created_at: string;
  updated_at: string;
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  async post<T>(path: string, body: any): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  async delete<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  // DAG endpoints
  async getVertices(): Promise<{ vertices: Vertex[] }> {
    return this.get('/api/v1/dag/vertices');
  }

  async createVertex(data: string, parents?: string[]): Promise<Vertex> {
    return this.post('/api/v1/dag/vertex', { data, parents });
  }

  async getDAGInfo(): Promise<any> {
    return this.get('/api/v1/dag/info');
  }

  // Crypto endpoints
  async encrypt(plaintext: string): Promise<EncryptResponse> {
    return this.post('/api/v1/crypto/encrypt', {
      plaintext: btoa(plaintext),
    });
  }

  async decrypt(ciphertext: string): Promise<DecryptResponse> {
    return this.post('/api/v1/crypto/decrypt', { ciphertext });
  }

  // Vault endpoints
  async getSecrets(): Promise<{ secrets: Secret[] }> {
    return this.get('/api/v1/vault/secrets');
  }

  async storeSecret(key: string, value: string): Promise<void> {
    return this.post('/api/v1/vault/store', { key, value });
  }

  async retrieveSecret(key: string): Promise<{ value: string }> {
    return this.get(`/api/v1/vault/retrieve/${key}`);
  }

  async deleteSecret(key: string): Promise<void> {
    return this.delete(`/api/v1/vault/delete/${key}`);
  }

  // Health check
  async checkHealth(): Promise<{ status: string }> {
    return this.get('/health');
  }
}

// WebSocket helper
export function createDAGWebSocket(
  onMessage: (vertex: Vertex) => void,
  onError?: (error: Event) => void,
  onClose?: () => void
): WebSocket {
  const ws = new WebSocket(`${WS_BASE_URL}/ws/dag`);

  ws.onmessage = (event) => {
    try {
      const vertex = JSON.parse(event.data);
      onMessage(vertex);
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
    }
  };

  if (onError) {
    ws.onerror = onError;
  }

  if (onClose) {
    ws.onclose = onClose;
  }

  return ws;
}

// Singleton instance
export const api = new ApiClient();
