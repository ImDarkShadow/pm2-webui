import { describe, it, expect } from 'vitest';
import { transitionEnrollmentState } from './index.js';

describe('Enrollment State Machine', () => {
  it('transitions from unregistered to pending on SUBMIT_HANDSHAKE', () => {
    const res = transitionEnrollmentState('unregistered', {
      type: 'SUBMIT_HANDSHAKE',
      agentId: 'agent-1',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toBe('pending');
    }
  });

  it('transitions from pending to online on ADMIN_APPROVE', () => {
    const res = transitionEnrollmentState('pending', {
      type: 'ADMIN_APPROVE',
      userId: 'admin-1',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toBe('online');
    }
  });

  it('transitions from pending to rejected on ADMIN_REJECT', () => {
    const res = transitionEnrollmentState('pending', {
      type: 'ADMIN_REJECT',
      userId: 'admin-1',
      reason: 'Unauthorized node IP',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toBe('rejected');
    }
  });

  it('transitions from online to offline on AGENT_DISCONNECTED', () => {
    const res = transitionEnrollmentState('online', {
      type: 'AGENT_DISCONNECTED',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toBe('offline');
    }
  });

  it('transitions from offline to online on AGENT_CONNECTED', () => {
    const res = transitionEnrollmentState('offline', {
      type: 'AGENT_CONNECTED',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toBe('online');
    }
  });

  it('transitions to revoked on ADMIN_REVOKE and rejects subsequent connections', () => {
    const res = transitionEnrollmentState('online', {
      type: 'ADMIN_REVOKE',
      userId: 'admin-1',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toBe('revoked');

      const connectAttempt = transitionEnrollmentState('revoked', {
        type: 'AGENT_CONNECTED',
      });
      expect(connectAttempt.ok).toBe(false);
      if (!connectAttempt.ok) {
        expect(connectAttempt.error.code).toBe('FORBIDDEN');
      }
    }
  });
});
