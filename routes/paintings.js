const express = require('express');
const { generatePaintings, getPaintings, streamPaintings, getJobStatus } = require('../controllers/paintingController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// All routes are protected
router.use(authMiddleware);

// Specific routes must come before dynamic :titleId
router.post('/generate', generatePaintings);
router.get('/stream/:titleId', streamPaintings);
router.get('/jobs/:jobId', getJobStatus);
router.get('/:titleId', getPaintings);

module.exports = router; 