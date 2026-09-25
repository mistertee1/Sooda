import http from 'node:http';
import { createApp } from '../../server.ts';
import { Database } from '../core/database/index.ts';
import { SessionService, SESSION_COOKIE_NAME } from '../core/auth/session.ts';
import { registerAuditDatabaseProvider, AuditLogService } from '../core/observability/index.ts';

async function main() {
  const db = Database.createInMemory();
  db.runMigrations();
  db.seedFoundation();
  const now = new Date().toISOString();

  db.rawDb.exec(`
    INSERT INTO users (id,email,normalized_email,phone,full_name,password_hash,password_algo,role,status,is_active,failed_login_attempts,created_at,updated_at)
    VALUES
      ('p2_owner_nomembership','owner.nomembership@sooda.test','owner.nomembership@sooda.test','+249900000101','Owner No Membership','test','argon2id','MERCHANT_OWNER','ACTIVE',1,0,'${now}','${now}'),
      ('p2_owner_a','owner.a@sooda.test','owner.a@sooda.test','+249900000102','Owner Store A','test','argon2id','MERCHANT_OWNER','ACTIVE',1,0,'${now}','${now}'),
      ('p2_staff_a','staff.a@sooda.test','staff.a@sooda.test','+249900000103','Staff Store A','test','argon2id','MERCHANT_STAFF','ACTIVE',1,0,'${now}','${now}');
    INSERT INTO tenant_memberships (id,user_id,tenant_id,role,status,created_at,updated_at)
    VALUES
      ('p2_m_owner_a','p2_owner_a','tenant_store_albaraka','MERCHANT_OWNER','ACTIVE','${now}','${now}'),
      ('p2_m_staff_a','p2_staff_a','tenant_store_albaraka','MERCHANT_STAFF','ACTIVE','${now}','${now}');
  `);

  registerAuditDatabaseProvider(() => db);
  AuditLogService.getInstance(db);
  const { app, sessionService } = createApp({ db });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const patch = (path: string, token: string) => new Promise<number>((resolve, reject) => {
    const payload = JSON.stringify({ nameEn: 'must-deny-or-authorize' });
    const req = http.request(new URL(path, base), { method: 'PATCH', headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload).toString() } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode || 0)); });
    req.on('error', reject); req.write(payload); req.end();
  });

  const ownerNoMembership = sessionService.createSession('p2_owner_nomembership', { actorRole: 'MERCHANT_OWNER', tenantId: null, skipAudit: true });
  const ownerA = sessionService.createSession('p2_owner_a', { actorRole: 'MERCHANT_OWNER', tenantId: 'tenant_store_albaraka', skipAudit: true });
  const staffA = sessionService.createSession('p2_staff_a', { actorRole: 'MERCHANT_STAFF', tenantId: 'tenant_store_albaraka', skipAudit: true });

  const cases = [
    ['P2-AUTH-01 owner role without target membership', await patch('/api/stores/tenant_store_nilecrafts', ownerNoMembership.rawToken), 403],
    ['P2-AUTH-02 owner of Store A cannot mutate Store B', await patch('/api/stores/tenant_store_nilecrafts', ownerA.rawToken), 403],
    ['P2-AUTH-03 staff membership cannot perform owner mutation', await patch('/api/stores/tenant_store_albaraka', staffA.rawToken), 403],
    ['P2-AUTH-04 authorized owner membership can mutate target store', await patch('/api/stores/tenant_store_albaraka', ownerA.rawToken), 200],
  ] as const;

  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const [name, actual, expected] of cases) {
    if (actual !== expected) throw new Error(`${name}: expected ${expected}, received ${actual}`);
    console.log(`PASS ${name}: HTTP ${actual}`);
  }
  console.log(`PHASE 2 AUTHORIZATION REGRESSION: ${cases.length}/${cases.length} PASSED`);
}

main().catch((error) => { console.error(error); process.exit(1); });
