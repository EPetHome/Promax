/** K10：同进程共享容量；立即占位或 FIFO 等待，取消不占用槽位。 */
import { performance } from 'node:perf_hooks';

function cancellation(signal, queueMs) {
  const reason = signal.reason;
  const error = new Error(String(reason?.message ?? reason ?? 'Skill execution cancelled'));
  error.queueMs = queueMs;
  return error;
}

class ForkQueue {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.waiters = [];
  }

  acquire(signal) {
    if (signal.aborted) return Promise.reject(cancellation(signal, 0));
    if (this.active < this.limit && this.waiters.length === 0) {
      this.active += 1;
      return Promise.resolve(this.ticket(0));
    }
    const started = performance.now();
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve, signal, started,
        abort: () => {
          const index = this.waiters.indexOf(waiter);
          if (index !== -1) this.waiters.splice(index, 1);
          reject(cancellation(signal, Math.max(0, Math.floor(performance.now() - started))));
        },
      };
      this.waiters.push(waiter);
      signal.addEventListener('abort', waiter.abort, { once: true });
    });
  }

  ticket(queueMs) {
    let released = false;
    return {
      queueMs,
      release: () => {
        if (released) return;
        released = true;
        const waiter = this.waiters.shift();
        if (waiter) {
          // 槽位直接移交，避免后来调用抢占排队者的名额。
          waiter.signal.removeEventListener('abort', waiter.abort);
          waiter.resolve(this.ticket(Math.max(0, Math.floor(performance.now() - waiter.started))));
        } else {
          this.active -= 1;
        }
      },
    };
  }
}

let shared;
export function processForkQueue(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('maxConcurrentForks must be a positive integer');
  if (!shared) shared = new ForkQueue(limit);
  if (shared.limit !== limit) throw new Error('Skill modules in one process must use the same maxConcurrentForks');
  return shared;
}
