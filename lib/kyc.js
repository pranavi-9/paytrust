// KYC helpers (Member B). Documents live in MongoDB (kyc_documents); the
// summary status lives in MySQL (users.kyc_status) so SQL queries and the
// admin user list can filter on it. MongoDB is the source of truth and
// syncKycStatus() recomputes the MySQL column from it, so the two can
// always be brought back in line by calling it again.
import { ObjectId } from 'mongodb';
import { query } from './mysql';
import { getDb, collections } from './mongo';
import { LedgerError } from './ledger';

export const DOC_TYPES = {
  aadhaar: 'Aadhaar card',
  pan: 'PAN card',
  passport: 'Passport',
  driving_licence: 'Driving licence',
  voter_id: 'Voter ID',
};

/** "XXXX-XXXX-1234" style mask. Only the last 4 characters are ever stored. */
export function maskNumber(docType, last4) {
  return docType === 'aadhaar' ? `XXXX-XXXX-${last4}` : `XXXXXX${last4}`;
}

export async function kycCollection() {
  return (await getDb()).collection(collections.kyc);
}

export function parseDocId(id) {
  if (typeof id !== 'string' || !ObjectId.isValid(id) || String(new ObjectId(id)) !== id) {
    throw new LedgerError('NOT_FOUND', 'document not found', 404);
  }
  return new ObjectId(id);
}

/**
 * users.kyc_status from the user's documents:
 *   any verified document          -> verified
 *   otherwise any pending document -> pending
 *   otherwise any rejected         -> rejected
 *   no documents                   -> pending (the schema default: not yet verified)
 */
export function overallStatus(docs) {
  if (docs.some((d) => d.status === 'verified')) return 'verified';
  if (docs.some((d) => d.status === 'pending')) return 'pending';
  if (docs.some((d) => d.status === 'rejected')) return 'rejected';
  return 'pending';
}

export async function syncKycStatus(userId) {
  const col = await kycCollection();
  const docs = await col.find({ user_id: userId }, { projection: { status: 1 } }).toArray();
  const status = overallStatus(docs);
  await query('UPDATE users SET kyc_status = ? WHERE id = ?', [status, userId]);
  return status;
}

export function serializeDoc(d) {
  return {
    id: String(d._id),
    user_id: d.user_id,
    doc_type: d.doc_type,
    number_masked: d.number_masked,
    file_url: d.file_url,
    status: d.status,
    rejection_reason: d.rejection_reason ?? null,
    reviewed_by: d.reviewed_by ?? null,
    reviewed_at: d.reviewed_at ? d.reviewed_at.toISOString() : null,
    submitted_at: d.submitted_at.toISOString(),
  };
}
