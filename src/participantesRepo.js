'use strict';

/**
 * Repositório das tabelas `participantes` e `checkin_log`.
 * O MySQL é a fonte da busca/autocomplete (Opção B).
 */

const pool = require('./db');

/**
 * Normaliza um participante cru da Sympla.
 * Os nomes de campo da v1.5.0 podem variar — ajuste aqui se necessário
 * após inspecionar o JSON real de um `sync`.
 */
function normalizar(p) {
    return {
        sympla_participant_id: p.id != null ? String(p.id) : null,
        ticket_number: p.ticket_number || p.ticket_num || '',
        // Código sem hífens, é o que vai dentro do QR code da etiqueta
        // e o que o scanner devolve na leitura.
        ticket_num_qr_code: p.ticket_num_qr_code || '',
        nome: [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
            || p.name || 'Sem nome',
        email: p.email || '',
        ticket_name: p.ticket_name || '',
        // a Sympla já pode indicar quem entrou; respeitamos isso no sync
        checkin_status: (p.checkin && p.checkin.check_in) ? 'CHECKED_IN' : 'PENDENTE',
    };
}

/**
 * Substitui (upsert) os participantes de um evento com a lista da Sympla.
 * Usa INSERT ... ON DUPLICATE KEY UPDATE para ser idempotente:
 * rodar o sync de novo não duplica linhas.
 */
async function upsertParticipantes(eventoId, listaCrua) {
    const lista = listaCrua
        .map(normalizar)
        .filter(p => p.ticket_number); // sem ticket não há como fazer check-in

    if (lista.length === 0) return 0;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Insere em lotes para não estourar o tamanho do pacote SQL.
        const LOTE = 500;
        for (let i = 0; i < lista.length; i += LOTE) {
            const fatia = lista.slice(i, i + LOTE);
            const valores = [];
            const placeholders = fatia.map(p => {
                valores.push(
                    eventoId, p.sympla_participant_id, p.ticket_number,
                    p.ticket_num_qr_code, p.nome, p.email, p.ticket_name,
                    p.checkin_status
                );
                return '(?, ?, ?, ?, ?, ?, ?, ?)';
            }).join(', ');

            await conn.query(
                `INSERT INTO participantes
                 (evento_id, sympla_participant_id, ticket_number,
                  ticket_num_qr_code, nome, email, ticket_name, checkin_status)
                 VALUES ${placeholders}
                 ON DUPLICATE KEY UPDATE
                                      sympla_participant_id = VALUES(sympla_participant_id),
                                      ticket_num_qr_code = VALUES(ticket_num_qr_code),
                                      nome        = VALUES(nome),
                                      email       = VALUES(email),
                                      ticket_name = VALUES(ticket_name)`,
                valores
            );
        }

        await conn.commit();
        return lista.length;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Busca exata por ingresso. Aceita tanto o `ticket_number` (com hífens)
 * quanto o `ticket_num_qr_code` (sem hífens, lido do QR) — assim o totem
 * funciona tanto com busca por nome quanto com leitura de QR.
 */
async function buscarPorTicket(eventoId, codigo) {
    const c = String(codigo || '').trim();
    const [rows] = await pool.query(
        `SELECT id, ticket_number, ticket_num_qr_code, nome, email,
            ticket_name, checkin_status, checkin_em
       FROM participantes
      WHERE evento_id = ?
        AND (ticket_number = ? OR ticket_num_qr_code = ?)
      LIMIT 1`,
        [eventoId, c, c]
    );
    return rows[0] || null;
}

/** Detalhe completo de um participante. */
async function buscarDetalhe(eventoId, participanteId) {
    const [rows] = await pool.query(
        `SELECT * FROM participantes
      WHERE evento_id = ? AND id = ?
      LIMIT 1`,
        [eventoId, participanteId]
    );
    return rows[0] || null;
}

/**
 * Busca textual para o autocomplete: nome, e-mail ou ticket.
 * `limit` pequeno (default 10) — é um dropdown, não uma listagem.
 */
async function buscar(eventoId, termo, limit = 10) {
    const t = `%${String(termo || '').trim()}%`;
    const lim = Math.min(Math.max(Number(limit) || 10, 1), 50);
    const [rows] = await pool.query(
        `SELECT id, ticket_number, ticket_num_qr_code, nome, ticket_name, checkin_status
       FROM participantes
      WHERE evento_id = ?
        AND (nome LIKE ? OR email LIKE ? OR ticket_number LIKE ?)
      ORDER BY nome
      LIMIT ?`,
        [eventoId, t, t, t, lim]
    );
    return rows;
}

/** Marca um participante como CHECKED_IN. */
async function marcarCheckin(participanteId) {
    await pool.query(
        `UPDATE participantes
         SET checkin_status = 'CHECKED_IN', checkin_em = NOW()
         WHERE id = ?`,
        [participanteId]
    );
}

/** Registra uma tentativa de check-in no histórico. */
async function registrarLog({ eventoId, participanteId, ticketNumber, resultado, origem, detalhe }) {
    await pool.query(
        `INSERT INTO checkin_log
       (evento_id, participante_id, ticket_number, resultado, origem, detalhe)
     VALUES (?, ?, ?, ?, ?, ?)`,
        [eventoId, participanteId || null, ticketNumber,
            resultado, origem || '', detalhe || '']
    );
}

/** Contadores para o painel do totem. */
async function contadores(eventoId) {
    const [rows] = await pool.query(
        `SELECT
       COUNT(*) AS total,
       SUM(checkin_status = 'CHECKED_IN') AS checked_in
     FROM participantes
     WHERE evento_id = ?`,
        [eventoId]
    );
    const r = rows[0] || {};
    return {
        total: Number(r.total || 0),
        checked_in: Number(r.checked_in || 0),
    };
}

module.exports = {
    upsertParticipantes,
    buscarPorTicket,
    buscarDetalhe,
    buscar,
    marcarCheckin,
    registrarLog,
    contadores,
};