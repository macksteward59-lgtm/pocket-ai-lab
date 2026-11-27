/** Self-consistency hash chain over synthetic observations; not a signed trust receipt. */
import { createHash } from 'node:crypto';

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function journalFor(taskId, observations) {
  if (!/^[A-Za-z0-9._:-]{1,96}$/.test(taskId)) throw new Error('invalid task identifier');
  if (!Array.isArray(observations) || observations.length < 1 || observations.length > 100) {
    throw new Error('invalid observation count');
  }
  let previous = 'GENESIS';
  return Object.freeze(observations.map((item, index) => {
    if (item.taskId !== taskId) throw new Error('observation task mismatch');
    const payload = JSON.stringify(item);
    const event = Object.freeze({sequence: index + 1, previousHash: previous, payload,
      eventHash: sha256(`${index + 1}\n${previous}\n${payload}`)});
    previous = event.eventHash;
    return event;
  }));
}

export function verifyJournal(journal) {
  if (!Array.isArray(journal) || journal.length < 1 || journal.length > 100) return false;
  let previous = 'GENESIS';
  let taskId = null;
  for (let index = 0; index < journal.length; index++) {
    const event = journal[index];
    if (!event || event.sequence !== index + 1 || event.previousHash !== previous ||
        typeof event.payload !== 'string' || typeof event.eventHash !== 'string' ||
        event.eventHash !== sha256(`${index + 1}\n${previous}\n${event.payload}`)) return false;
    let payload;
    try { payload = JSON.parse(event.payload); } catch { return false; }
    if (typeof payload.taskId !== 'string' || (taskId !== null && taskId !== payload.taskId)) return false;
    taskId = payload.taskId;
    previous = event.eventHash;
  }
  return true;
}
