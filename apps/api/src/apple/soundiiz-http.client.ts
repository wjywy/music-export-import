import { BadGatewayException, Injectable } from '@nestjs/common';
import { request as httpsRequest } from 'node:https';

export interface SoundiizHttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

@Injectable()
export class SoundiizHttpClient {
  /**
   * Use node:https directly instead of global fetch so an environment HTTP
   * proxy cannot silently intercept this request (Node's fetch can otherwise
   * fail with UND_ERR_CONNECT_TIMEOUT behind a local proxy).
   */
  post(payload: Record<string, unknown>): Promise<SoundiizHttpResponse> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      const req = httpsRequest(
        'https://soundiiz.com/go/import-playlist',
        {
          method: 'POST',
          family: 4,
          timeout: 30_000,
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'user-agent': BROWSER_UA,
            'content-length': Buffer.byteLength(body),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          response.on('end', () => {
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
          response.on('error', (error) => {
            reject(
              new BadGatewayException(
                `读取 Soundiiz 响应失败：${error.message}`,
              ),
            );
          });
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error('timeout'));
      });
      req.on('error', (error: NodeJS.ErrnoException) => {
        reject(
          new BadGatewayException(
            `连接 Soundiiz 失败（${error.code ?? 'network'}），请稍后重试。`,
          ),
        );
      });
      req.end(body);
    });
  }
}
