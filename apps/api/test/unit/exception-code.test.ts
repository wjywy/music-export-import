import test from 'node:test';
import assert from 'node:assert/strict';
import { BadGatewayException, type ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from '../../src/common/all-exceptions.filter';

test('HTTP exception filter preserves the public error code used by login clients', () => {
  let status: number | undefined;
  let body: unknown;
  const response = { status(value: number) { status = value; return this; }, json(value: unknown) { body = value; } };
  const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(new BadGatewayException({ code: 'NETEASE_PROFILE_FORBIDDEN', message: '资料授权受限' }), host);
  assert.equal(status, 502);
  assert.deepEqual(body, { statusCode: 502, code: 'NETEASE_PROFILE_FORBIDDEN', message: '资料授权受限' });
});
