import https from 'https';
import { URL } from 'url';

const X_API_URL = 'https://api.twitter.com/2/tweets';

export class XAPIClient {
  constructor(accessToken) {
    this.accessToken = accessToken;
  }

  makeRequest(method, url, body = null) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);

      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: method,
        headers: {
          'User-Agent': 'Web-Agent-X-Poster/1.0',
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject({
                status: res.statusCode,
                error: parsed.errors || parsed.error || parsed,
                body: data
              });
            } else {
              resolve({
                status: res.statusCode,
                data: parsed
              });
            }
          } catch (e) {
            reject({
              status: res.statusCode,
              error: 'Invalid JSON response',
              body: data
            });
          }
        });
      });

      req.on('error', reject);

      if (body && method === 'POST') {
        const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
        req.write(bodyStr);
      }

      req.end();
    });
  }

  async postTweet(text) {
    if (!text || text.length === 0) {
      throw new Error('Tweet text cannot be empty');
    }

    if (text.length > 280) {
      throw new Error(`Tweet exceeds 280 characters: ${text.length} chars`);
    }

    const body = JSON.stringify({ text });
    const url = X_API_URL;

    try {
      const response = await this.makeRequest('POST', url, body);

      if (response.data.data && response.data.data.id) {
        return {
          success: true,
          post_id: response.data.data.id,
          text: text,
          timestamp: new Date().toISOString(),
          url: `https://twitter.com/i/web/status/${response.data.data.id}`
        };
      } else {
        throw new Error('No post ID in response');
      }
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Unknown error',
        status: error.status,
        details: error.error
      };
    }
  }
}

export async function postToX(text, accessToken) {
  if (!accessToken) {
    return {
      success: false,
      error: 'Missing X API access token in environment'
    };
  }

  const client = new XAPIClient(accessToken);
  return client.postTweet(text);
}
