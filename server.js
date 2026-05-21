'use strict';

require('dotenv').config();

const express = require('express');
const apiRoutes = require('./src/routes');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// CORS — em produção, restrinja ao domínio do seu web app.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------------------------------------------------------------------
//  IMPORTANTE — separar os dois mundos:
//
//  As rotas de configuração (POST /api/eventos, GET /api/eventos, sync)
//  manipulam tokens da Sympla e devem ficar atrás da SUA autenticação.
//
//  As rotas do totem (search, checkin, status) são as únicas que a
//  interface pública /toten/{eventoId} deve poder acessar.
//
//  Sugestão: aplique aqui um middleware de auth só nas rotas de
//  configuração antes de ir para produção. Ex.:
//
//    app.use('/api/eventos', soGET_e_naoEhSubrota ? ... : exigirAuthAdmin);
//
//  Para manter o exemplo enxuto, deixo o gancho indicado mas não imposto.
// ---------------------------------------------------------------------

app.use('/api', apiRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

// Tratador de erros centralizado.
app.use((err, req, res, next) => {
  console.error('Erro:', err);
  res.status(500).json({ ok: false, erro: 'Erro interno.', detalhe: err.message });
});

app.listen(PORT, () => {
  console.log(`Backend multi-evento de check-in Sympla na porta ${PORT}`);
});