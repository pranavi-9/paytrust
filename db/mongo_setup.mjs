// =====================================================================
// PayTrust: MongoDB setup (Member B)
//   npm run db:mongo
// Creates dispute_cases, kyc_documents and activity_logs with schema
// validation and indexes. Safe to run again: existing collections get
// their validator updated and existing indexes are left in place.
//
// MongoDB never stores money. Disputes and KYC point at MySQL rows by id
// (escrow_id, user_id); the ledger in MySQL stays the source of truth.
// =====================================================================
import { MongoClient } from 'mongodb';
import { pathToFileURL } from 'node:url';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'paytrust';
if (!uri) {
  console.error('Missing MONGODB_URI. Copy .env.example to .env first.');
  process.exit(1);
}

const mysqlId = { bsonType: ['int', 'long'], minimum: 1 };
const date = { bsonType: 'date' };

export const collectionsSpec = {
  dispute_cases: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['escrow_id', 'raised_by', 'against', 'reason', 'status', 'evidence', 'messages', 'created_at', 'updated_at'],
        properties: {
          escrow_id: mysqlId,
          raised_by: mysqlId,
          against: mysqlId,
          reason: { enum: ['not_delivered', 'not_as_described', 'partial_delivery', 'quality_issue', 'other'] },
          description: { bsonType: 'string', maxLength: 2000 },
          status: { enum: ['open', 'under_review', 'resolved'] },
          evidence: {
            bsonType: 'array',
            items: {
              bsonType: 'object',
              required: ['uploaded_by', 'file_url', 'uploaded_at'],
              properties: {
                uploaded_by: mysqlId,
                file_url: { bsonType: 'string' },
                caption: { bsonType: 'string', maxLength: 500 },
                uploaded_at: date,
              },
            },
          },
          messages: {
            bsonType: 'array',
            items: {
              bsonType: 'object',
              required: ['sender_id', 'body', 'sent_at'],
              properties: {
                sender_id: mysqlId,
                body: { bsonType: 'string', minLength: 1, maxLength: 2000 },
                sent_at: date,
              },
            },
          },
          resolution: {
            bsonType: 'object',
            required: ['decision', 'resolved_by', 'resolved_at'],
            properties: {
              decision: { enum: ['release', 'refund'] },
              resolved_by: mysqlId,
              resolved_at: date,
              note: { bsonType: 'string', maxLength: 2000 },
              settle_txn_id: mysqlId, // MySQL transaction that moved the money
            },
          },
          created_at: date,
          updated_at: date,
        },
      },
    },
    indexes: [
      // At most one active dispute per escrow.
      {
        key: { escrow_id: 1 },
        name: 'uq_active_dispute_per_escrow',
        unique: true,
        partialFilterExpression: { status: { $in: ['open', 'under_review'] } },
      },
      { key: { escrow_id: 1, created_at: -1 }, name: 'idx_escrow_history' },
      // Admin dispute queue: open cases, oldest first.
      { key: { status: 1, created_at: 1 }, name: 'idx_status_created' },
      // "My disputes" for either party.
      { key: { raised_by: 1, created_at: -1 }, name: 'idx_raised_by' },
      { key: { against: 1, created_at: -1 }, name: 'idx_against' },
    ],
  },

  kyc_documents: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['user_id', 'doc_type', 'number_masked', 'file_url', 'status', 'submitted_at'],
        properties: {
          user_id: mysqlId,
          doc_type: { enum: ['aadhaar', 'pan', 'passport', 'driving_licence', 'voter_id'] },
          // Store only a masked number (e.g. XXXX-XXXX-1234), never the full ID.
          number_masked: { bsonType: 'string', pattern: '^[X*]+[-X* ]*[0-9A-Z]{2,4}$' },
          file_url: { bsonType: 'string' },
          status: { enum: ['pending', 'verified', 'rejected'] },
          rejection_reason: { bsonType: 'string', maxLength: 500 },
          reviewed_by: mysqlId,
          reviewed_at: date,
          submitted_at: date,
        },
      },
    },
    indexes: [
      { key: { user_id: 1, doc_type: 1 }, name: 'uq_user_doc_type', unique: true },
      // Admin KYC review queue.
      { key: { status: 1, submitted_at: 1 }, name: 'idx_status_submitted' },
    ],
  },

  activity_logs: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['action', 'created_at'],
        properties: {
          user_id: { bsonType: ['int', 'long', 'null'] }, // null for failed logins etc.
          action: { bsonType: 'string', maxLength: 64 }, // e.g. login, transfer.create, escrow.fund
          entity_type: { enum: ['user', 'wallet', 'transaction', 'escrow', 'dispute', 'kyc', null] },
          entity_id: { bsonType: ['int', 'long', 'string', 'null'] },
          ip: { bsonType: 'string' },
          metadata: { bsonType: 'object' }, // free-form; never put passwords or tokens here
          created_at: date,
        },
      },
    },
    indexes: [
      { key: { user_id: 1, created_at: -1 }, name: 'idx_user_time' },
      { key: { action: 1, created_at: -1 }, name: 'idx_action_time' },
      { key: { entity_type: 1, entity_id: 1 }, name: 'idx_entity' },
      // Logs expire after 180 days.
      { key: { created_at: 1 }, name: 'ttl_created_at', expireAfterSeconds: 60 * 60 * 24 * 180 },
    ],
  },
};

export async function setup(db) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

  for (const [name, spec] of Object.entries(collectionsSpec)) {
    if (existing.has(name)) {
      await db.command({ collMod: name, validator: spec.validator, validationLevel: 'strict', validationAction: 'error' });
      console.log(`updated validator  ${name}`);
    } else {
      await db.createCollection(name, { validator: spec.validator, validationLevel: 'strict', validationAction: 'error' });
      console.log(`created collection ${name}`);
    }
    await db.collection(name).createIndexes(spec.indexes);
    console.log(`  indexes: ${spec.indexes.map((i) => i.name).join(', ')}`);
  }
}

// Run directly (not when imported by a test).
// pathToFileURL handles Windows drive letters, backslashes and spaces.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    await setup(client.db(dbName));
    console.log(`Done. Database: ${dbName}`);
  } catch (err) {
    console.error('Mongo setup failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}
