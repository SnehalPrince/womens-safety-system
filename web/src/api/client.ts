export interface ApiError {
  error: string;
  details?: any;
}

class ApiClient {
  private getAuthHeader(): Record<string, string> {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async request<T>(path: string, options: RequestInit = {}, retries = 2): Promise<T> {
    const headers = {
      'Content-Type': 'application/json',
      ...this.getAuthHeader(),
      ...options.headers,
    };

    try {
      const response = await fetch(path, {
        ...options,
        headers,
      });

      if (!response.ok) {
        let errBody: any = {};
        try {
          errBody = await response.json();
        } catch {
          errBody = { error: response.statusText };
        }
        throw new Error(errBody.error || `HTTP error ${response.status}`);
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return {} as T;
      }

      return await response.json();
    } catch (err: any) {
      if (retries > 0 && (err.name === 'TypeError' || err.message.includes('fetch'))) {
        // Wait with exponential backoff (e.g. 500ms, 1000ms)
        const backoff = (3 - retries) * 500;
        await new Promise((resolve) => setTimeout(resolve, backoff));
        return this.request<T>(path, options, retries - 1);
      }
      throw err;
    }
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  post<T>(path: string, body?: any): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  put<T>(path: string, body?: any): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  del<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

export const api = new ApiClient();
