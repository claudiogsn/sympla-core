'use strict';

/**
 * Repositório da tabela `eventos`.
 *
 * No modelo multi-produtor, o token NÃO fica no evento — ele vem do
 * produtor dono do evento. getCredenciais faz o JOIN para obtê-lo.
 * Nenhuma função de leitura devolve o token.
 */

const pool = require('./db');

/** Remove qualquer token antes de devolver um evento ao cliente. */
function toEventoPublico(row) {
    if (!row) return null;
    const { sympla_token, ...publico } = row;
    return publico;
}

/** Lista todos os eventos (sem token). */
async function listar() {
    const [rows] = await pool.query(
        'SELECT * FROM eventos ORDER BY criado_em DESC'
    );
    return rows.map(toEventoPublico);
}

/** Lista os eventos de um produtor (sem token). */
async function listarPorProdutor(produtorId) {
    const [rows] = await pool.query(
        'SELECT * FROM eventos WHERE produtor_id = ? ORDER BY criado_em DESC',
        [produtorId]
    );
    return rows.map(toEventoPublico);
}

/** Busca um evento pelo id interno (sem token). */
async function buscarPublico(eventoId) {
    const [rows] = await pool.query(
        'SELECT * FROM eventos WHERE id = ? LIMIT 1',
        [eventoId]
    );
    return toEventoPublico(rows[0]);
}

/**
 * Retorna { id, sympla_event_id, sympla_token } de um evento.
 * O token vem do produtor dono do evento (JOIN).
 * USO INTERNO — para o backend chamar a API Sympla. Nunca exponha isto.
 */
async function getCredenciais(eventoId) {
    const [rows] = await pool.query(
        `SELECT e.id, e.sympla_event_id, p.sympla_token
         FROM eventos e
                  JOIN produtores p ON p.id = e.produtor_id
         WHERE e.id = ?
         LIMIT 1`,
        [eventoId]
    );
    return rows[0] || null;
}

/** Verifica se um evento da Sympla já foi importado por este produtor. */
async function existePorSymplaId(produtorId, symplaEventId) {
    const [rows] = await pool.query(
        `SELECT id FROM eventos
      WHERE produtor_id = ? AND sympla_event_id = ?
      LIMIT 1`,
        [produtorId, String(symplaEventId)]
    );
    return rows[0] || null;
}

/**
 * Cadastra (importa) um evento vinculado a um produtor.
 * A coluna sympla_token de eventos recebe '' — o token vem do produtor.
 */
async function criar({ produtor_id, sympla_event_id, nome, local, data_inicio, data_fim }) {
    const [result] = await pool.query(
        `INSERT INTO eventos
       (produtor_id, sympla_event_id, sympla_token, nome, local, data_inicio, data_fim)
     VALUES (?, ?, '', ?, ?, ?, ?)`,
        [produtor_id, String(sympla_event_id), nome || '', local || '',
            data_inicio || null, data_fim || null]
    );
    return buscarPublico(result.insertId);
}

/** Atualiza os metadados de sincronização após um sync. */
async function registrarSync(eventoId, totalSincronizado) {
    await pool.query(
        `UPDATE eventos
        SET ultima_sync = NOW(), total_sincronizado = ?
      WHERE id = ?`,
        [totalSincronizado, eventoId]
    );
}

module.exports = {
    listar,
    listarPorProdutor,
    buscarPublico,
    getCredenciais,
    existePorSymplaId,
    criar,
    registrarSync,
};