import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Taking turns with the backend's one run worker.
 *
 * The backend runs one backtest or validation at a time, for everyone, and says
 * so with a 409. Spec files run in parallel in separate processes, so two of them
 * submitting real runs will take that worker from each other: a direct submit
 * sees the 409 (and can wait), but a submit made by clicking the form just stays
 * on the page, which is a test failing for a reason that is not a fault.
 *
 * So the files that need the worker take turns through a lock on disk. A
 * directory is the lock, because creating one is atomic on every platform.
 */
const LOCK = join(tmpdir(), 'srable-e2e-run-worker.lock');
const TAKEN_AT = join(LOCK, 'taken-at');

/**
 * The holder says it is still alive every few seconds, so a lock that stops being
 * refreshed was abandoned by a run that was killed rather than released, and can
 * be taken over quickly. Without the heartbeat these two numbers fight each
 * other: long enough not to steal a live lock means long enough to stall.
 */
const HEARTBEAT = 5_000;
const ABANDONED_AFTER = 60_000;
/**
 * Rather than hang for ever, give up waiting and run anyway. Generous, because
 * the file holding the lock can legitimately run for ten minutes or more; the
 * heartbeat is what protects against waiting on a lock nobody holds.
 */
const GIVE_UP_AFTER = 25 * 60_000;

export type Release = () => Promise<void>;

export async function takeTheRunWorker(): Promise<Release> {
  const deadline = Date.now() + GIVE_UP_AFTER;
  for (;;) {
    try {
      await mkdir(LOCK);
      await writeFile(TAKEN_AT, String(Date.now()), 'utf8');
      const beat = setInterval(() => {
        void writeFile(TAKEN_AT, String(Date.now()), 'utf8').catch(() => {});
      }, HEARTBEAT);
      beat.unref?.();
      return releaseOnce(beat);
    } catch {
      const takenAt = Number(await readFile(TAKEN_AT, 'utf8').catch(() => '0'));
      if (takenAt && Date.now() - takenAt > ABANDONED_AFTER) {
        await rm(LOCK, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) return async () => {};
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

function releaseOnce(beat: ReturnType<typeof setInterval>): Release {
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    clearInterval(beat);
    await rm(LOCK, { recursive: true, force: true });
  };
}
