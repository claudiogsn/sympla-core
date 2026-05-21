'use strict';

/**
 * Cache em memória dos participantes do evento.
 *
 * Por que existe: protege contra o rate limit da Sympla. Em vez de chamar
 * a API a cada leitura de QR code, sincronizamos a lista uma vez e fazemos
 * a busca localmente, de forma instantânea.
 *
 * A chamada de check-in continua indo à Sympla em tempo real — é a Sympla
 * que é a fonte de verdade sobre "este ingresso já foi usado?".
 */

let participantes = [];        // lista crua vinda da Sympla
let porTicket = new Map();     // ticket_number (lowercase) -> participante
let ultimaSync = null;         // timestamp da última sincronização

/**
 * Normaliza um participante da Sympla para um formato estável de uso interno.
 * Os nomes de campo podem variar levemente; tratamos os mais comuns.
 */
function normalizar(p) {
  return {
    id: p.id,
    ticket_number: p.ticket_number || p.ticket_num || '',
    nome: [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
      || p.name || 'Sem nome',
    email: p.email || '',
    ticket_name: p.ticket_name || '',
    checkin_sympla: Boolean(p.checkin && p.checkin.check_in),
    raw: p,
  };
}

/**
 * Substitui todo o cache pela lista recém-sincronizada.
 */
function setParticipantes(lista) {
  participantes = lista.map(normalizar);
  porTicket = new Map();
  for (const p of participantes) {
    if (p.ticket_number) {
      porTicket.set(p.ticket_number.toLowerCase(), p);
    }
  }
  ultimaSync = new Date().toISOString();
}

/**
 * Busca exata por número de ingresso (usada no scan do QR code).
 */
function buscarPorTicket(ticketNumber) {
  if (!ticketNumber) return null;
  return porTicket.get(String(ticketNumber).toLowerCase()) || null;
}

/**
 * Busca textual por nome, e-mail ou ticket (usada na busca manual).
 */
function buscarTexto(termo) {
  const t = String(termo || '').toLowerCase().trim();
  if (!t) return [];
  return participantes
    .filter(p =>
      p.nome.toLowerCase().includes(t) ||
      p.email.toLowerCase().includes(t) ||
      p.ticket_number.toLowerCase().includes(t)
    )
    .slice(0, 30);
}

/**
 * Marca localmente que o check-in foi confirmado, para feedback imediato
 * sem precisar re-sincronizar a lista inteira.
 */
function marcarCheckinLocal(ticketNumber) {
  const p = buscarPorTicket(ticketNumber);
  if (p) p.checkin_sympla = true;
}

function status() {
  return {
    total: participantes.length,
    checked_in: participantes.filter(p => p.checkin_sympla).length,
    ultima_sync: ultimaSync,
  };
}

module.exports = {
  setParticipantes,
  buscarPorTicket,
  buscarTexto,
  marcarCheckinLocal,
  status,
};
