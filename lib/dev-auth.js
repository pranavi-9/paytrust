// TEMPORARY (Member A only): reads the acting user from the X-Dev-User header so
// the ledger APIs can be tested before Member B's auth exists.
// When B's auth lands, delete this file and make getActorId() read the session.
import { LedgerError } from './ledger';
export function getActorId(request) {
  if (process.env.NODE_ENV === 'production') throw new LedgerError('FORBIDDEN', 'dev auth disabled', 403);
  const id = Number(request.headers.get('x-dev-user'));
  if (!Number.isInteger(id) || id <= 0) throw new LedgerError('FORBIDDEN', 'not signed in', 403);
  return id;
}
