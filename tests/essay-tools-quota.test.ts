import { describe, it, expect, beforeEach } from 'vitest';
import {
  consume,
  refund,
  peek,
  __resetForTests,
  FREE_DAILY_LIMIT,
} from '../lib/essay-tools-quota';

describe('essay-tools-quota', () => {
  beforeEach(() => {
    __resetForTests();
  });

  describe('consume', () => {
    it('grants the first analysis to a new free user', () => {
      const r = consume('user-1', false);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(FREE_DAILY_LIMIT - 1);
      expect(r.unlimited).toBe(false);
    });

    it('allows exactly FREE_DAILY_LIMIT analyses then blocks', () => {
      for (let i = 0; i < FREE_DAILY_LIMIT; i++) {
        const r = consume('user-2', false);
        expect(r.allowed).toBe(true);
      }
      const blocked = consume('user-2', false);
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
    });

    it('decrements remaining each call', () => {
      expect(consume('user-3', false).remaining).toBe(FREE_DAILY_LIMIT - 1);
      expect(consume('user-3', false).remaining).toBe(FREE_DAILY_LIMIT - 2);
      expect(consume('user-3', false).remaining).toBe(FREE_DAILY_LIMIT - 3);
    });

    it('keeps users isolated from each other', () => {
      consume('user-a', false);
      consume('user-a', false);
      const aPeek = peek('user-a', false);
      const bPeek = peek('user-b', false);
      expect(aPeek.remaining).toBe(FREE_DAILY_LIMIT - 2);
      expect(bPeek.remaining).toBe(FREE_DAILY_LIMIT);
    });

    it('always returns unlimited for Pro users', () => {
      // Pro users should never be blocked, even after many calls
      for (let i = 0; i < 100; i++) {
        const r = consume('pro-user', true);
        expect(r.allowed).toBe(true);
        expect(r.unlimited).toBe(true);
        expect(r.remaining).toBe(-1);
      }
    });

    it('does not increment counter for Pro users', () => {
      consume('pro-then-free', true);
      consume('pro-then-free', true);
      consume('pro-then-free', true);
      // If they downgrade, they should still get all their slots
      const r = peek('pro-then-free', false);
      expect(r.remaining).toBe(FREE_DAILY_LIMIT);
    });

    it('coerces userId to a string', () => {
      // @ts-expect-error testing runtime coercion
      consume(123, false);
      // @ts-expect-error testing runtime coercion
      const r = peek(123, false);
      expect(r.remaining).toBe(FREE_DAILY_LIMIT - 1);
    });
  });

  describe('refund', () => {
    it('returns a slot to a free user after consume', () => {
      consume('refund-1', false);
      consume('refund-1', false);
      // Now at remaining = limit - 2
      refund('refund-1', false);
      const r = peek('refund-1', false);
      expect(r.remaining).toBe(FREE_DAILY_LIMIT - 1);
    });

    it('does not allow remaining to exceed the limit', () => {
      // Refund without ever consuming should be a no-op
      refund('refund-2', false);
      refund('refund-2', false);
      const r = peek('refund-2', false);
      expect(r.remaining).toBe(FREE_DAILY_LIMIT);
    });

    it('is a no-op for Pro users', () => {
      refund('pro-refund', true);
      const r = peek('pro-refund', true);
      expect(r.unlimited).toBe(true);
    });

    it('lets a blocked user retry after a refund', () => {
      // Burn through all slots
      for (let i = 0; i < FREE_DAILY_LIMIT; i++) {
        consume('blocked-then-refunded', false);
      }
      // Confirm blocked
      expect(consume('blocked-then-refunded', false).allowed).toBe(false);
      // Refund one
      refund('blocked-then-refunded', false);
      // Should now be able to consume one more
      const r = consume('blocked-then-refunded', false);
      expect(r.allowed).toBe(true);
    });
  });

  describe('peek', () => {
    it('returns full quota for a user with no history', () => {
      const r = peek('peek-1', false);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(FREE_DAILY_LIMIT);
    });

    it('does not mutate state', () => {
      peek('peek-2', false);
      peek('peek-2', false);
      peek('peek-2', false);
      const r = consume('peek-2', false);
      expect(r.remaining).toBe(FREE_DAILY_LIMIT - 1);
    });

    it('reflects current usage', () => {
      consume('peek-3', false);
      consume('peek-3', false);
      const r = peek('peek-3', false);
      expect(r.remaining).toBe(FREE_DAILY_LIMIT - 2);
    });

    it('returns unlimited for Pro users', () => {
      const r = peek('peek-pro', true);
      expect(r.unlimited).toBe(true);
      expect(r.remaining).toBe(-1);
    });
  });
});
