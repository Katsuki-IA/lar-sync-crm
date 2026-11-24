import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { resolution } from './visit-development-context.mjs';

test('resolve o empreendimento da visita dentro da empresa do lead', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table empreendimento(id bigint, id_empresa bigint);
      insert into empreendimento values (72,41), (80,42), (81,42)`);
    const query = `select ${resolution} as id from (select $1::bigint id_empresa,
      $2::bigint empreendimento_em_foco_id, $3::bigint id_empreendimento) l`;
    for (const [empresa, foco, cadastro, esperado] of [
      [41, null, 72, 72], [41, null, null, 72], [42, 81, 80, 81],
      [42, null, 80, null], [41, 80, 72, null], [41, null, 80, null],
      [43, null, null, null],
    ]) {
      const {rows} = await db.query(query, [empresa, foco, cadastro]);
      assert.equal(rows[0].id, esperado);
    }
  } finally {
    await db.close();
  }
});
