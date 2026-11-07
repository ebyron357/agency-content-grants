import { describe, expect, it } from 'vitest';
import { friendlyError } from './api';

describe('friendlyError', () => {
  it("uses the server's own message from a JSON body", () => {
    expect(friendlyError(new Error('POST /grants/applicants failed: 400 {"error":"Enter the legal name."}'))).toBe('Enter the legal name.');
  });

  it('uses the message on a generated-client error', () => {
    const error = Object.assign(new Error('HTTP 422 Unprocessable Entity: Title is required'), { status: 422, data: { error: 'Title is required' } });
    expect(friendlyError(error)).toBe('Title is required');
  });

  it('never shows the method, path, status or an HTML page', () => {
    const html = friendlyError(new Error('GET /grants/meta failed: 502 <!DOCTYPE html><html><body>Bad gateway</body></html>'));
    expect(html).toBe('Something went wrong on our side. Try again in a minute.');
    expect(friendlyError(new Error('DELETE /brands/1 failed: 404 '))).toBe('We could not find that. It may have been moved or removed.');
    expect(friendlyError(new Error('PATCH /x failed: 403 Forbidden'))).toBe('Your role cannot do this. Ask an owner or admin of your workspace.');
    expect(friendlyError(Object.assign(new Error('HTTP 500 Internal Server Error'), { status: 500 }))).toBe('Something went wrong on our side. Try again in a minute.');
  });

  it('explains a network failure', () => {
    expect(friendlyError(new TypeError('Failed to fetch'))).toBe('Could not reach GrantCrest. Check your internet connection and try again.');
  });

  it('keeps plain-language messages and falls back when there is nothing to say', () => {
    expect(friendlyError(new Error('Provider returned 529: overloaded'))).toBe('Provider returned 529: overloaded');
    expect(friendlyError(undefined, 'Could not save.')).toBe('Could not save.');
    expect(friendlyError(new Error(''), 'Could not save.')).toBe('Could not save.');
  });
});
