import { GET } from './api/health/route';

export const dynamic = 'force-dynamic';

// Temporary home page: shows the database connection test until the dashboard exists (week 2).
export default async function Home() {
  const health = await (await GET()).json();

  return (
    <main>
      <h1>PayTrust</h1>
      <p className="muted">Escrow-backed payments. Connection check:</p>

      <Status label="MySQL" info={health.mysql} detail={health.mysql.ok && `${health.mysql.database} · ${health.mysql.tables.length} tables`} />
      <Status label="MongoDB" info={health.mongo} detail={health.mongo.ok && `${health.mongo.database} · ${health.mongo.collections.length} collections`} />

      <p className="muted" style={{ marginTop: 24 }}>
        Raw JSON at <code>/api/health</code>
      </p>
    </main>
  );
}

function Status({ label, info, detail }) {
  return (
    <div className="card">
      <strong>{label}</strong>{' '}
      {info.ok ? <span className="ok">connected</span> : <span className="bad">not connected</span>}
      <div className="muted">{info.ok ? detail : info.error}</div>
    </div>
  );
}
