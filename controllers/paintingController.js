const { pool } = require('../database');
const openRouterService = require('../services/openRouterService');
const openAIService = require('../services/openAIService');
const sse = require('../services/sse');
const jobs = require('../services/jobQueue');

// Generate painting ideas (enqueue and process fully in background)
async function generatePaintings(req, res) {
  if (!req.user || !req.user.id) {
    console.error('User not authenticated properly');
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { titleId, quantity = 3, skipIdeas } = req.body;
  const IMAGE_MAX_PARALLEL = parseInt(process.env.IMAGES_MAX_PARALLEL || '5', 10);
  
  if (!titleId) {
    return res.status(400).json({ error: 'Title ID is required' });
  }

  try {
    // Create a job and return immediately
    const job = jobs.createJob({ titleId, quantity });
    // Notify header UI that a job has started (client may aggregate by title)
    sse.publish(titleId, { type: 'jobStarted', payload: { titleId, quantity, jobId: job.id } });
    res.status(202).json({ message: `Enqueued generation of ${quantity} paintings`, jobId: job.id });

    // Background worker
    (async () => {
      try {
        jobs.startJob(job.id);

        // Get title info
        const titleParams = [titleId];
        if (titleParams.some(p => p === undefined)) {
          console.error('Attempted to execute query with undefined parameter:', { titleParams });
          throw new Error('Invalid query parameter detected');
        }
        const [titleRows] = await pool.execute(
          'SELECT id, title, instructions FROM titles WHERE id = ?',
          titleParams
        );
        if (titleRows.length === 0) {
          throw new Error('Title not found');
        }
        const title = titleRows[0];

        // Get reference images
        const refParams = [titleId, req.user.id];
        if (refParams.some(p => p === undefined)) {
          console.error('Attempted to execute query with undefined parameter:', { refParams });
          throw new Error('Invalid query parameter detected');
        }
        const [refRows] = await pool.execute(
          'SELECT id, image_data FROM references2 WHERE title_id = ? OR (user_id = ? AND is_global = 1)',
          refParams
        );
        const references = refRows.map(row => ({ id: row.id, image_data: row.image_data }));

        // Get previous ideas for this title to avoid duplication
        const prevParams = [titleId];
        if (prevParams.some(p => p === undefined)) {
          console.error('Attempted to execute query with undefined parameter:', { prevParams });
          throw new Error('Invalid query parameter detected');
        }
        const [prevIdeas] = await pool.execute(
          'SELECT id, summary FROM ideas WHERE title_id = ? ORDER BY created_at DESC',
          prevParams
        );

        // Pre-create idea stubs and paintings so placeholders are stable
        const newIdeas = [];
        const stubIdeaIds = [];
        for (let i = 0; i < quantity; i++) {
          const [stubRes] = await pool.execute(
            'INSERT INTO ideas (title_id, summary, full_prompt) VALUES (?, ?, ?)',
            [titleId, '', '']
          );
          const ideaId = stubRes.insertId;
          stubIdeaIds.push(ideaId);
          await pool.execute(
            'INSERT INTO paintings (title_id, idea_id, status) VALUES (?, ?, ?)',
            [titleId, ideaId, 'pending']
          );
          sse.publish(titleId, { type: 'paintingCreated', payload: { titleId, ideaId, status: 'pending' } });
        }

        // Image generation queue with concurrency
        const pendingImageIdeas = [];
        const activeImagePromises = [];
        const startNextImage = () => {
          while (pendingImageIdeas.length > 0 && activeImagePromises.length < IMAGE_MAX_PARALLEL) {
            const idea = pendingImageIdeas.shift();
            const p = openAIService.generateImage(idea.id, idea.fullPrompt, references)
              .then(result => {
                sse.publish(titleId, { type: 'paintingUpdated', payload: { ideaId: idea.id, status: result.status, image_url: result.imageUrl } });
                jobs.incrementCompleted(job.id);
              })
              .catch(error => {
                console.error(`Error generating image for idea ${idea.id}:`, error);
                sse.publish(titleId, { type: 'paintingUpdated', payload: { ideaId: idea.id, status: 'failed', error: String(error.message || error) } });
                jobs.incrementFailed(job.id);
              })
              .finally(() => {
                const index = activeImagePromises.indexOf(p);
                if (index !== -1) activeImagePromises.splice(index, 1);
                startNextImage();
              });
            activeImagePromises.push(p);
          }
        };

        // If skipping idea generation, derive prompts directly from title and instructions
        if (skipIdeas === true || String(process.env.SKIP_IDEA_GENERATION).toLowerCase() === 'true') {
          const styleVariations = [
            'Bold complementary colors, high contrast, dramatic lighting.',
            'Muted pastel palette, soft gradients, minimalistic composition.',
            'Abstract geometric forms, asymmetry, emphasis on negative space.',
            'Textured brushstroke effect, painterly style, warm tones.',
            'Futuristic neon palette, cyberpunk mood, high saturation.',
            'Monochrome noir, strong chiaroscuro, cinematic framing.',
            'Organic shapes, nature-inspired patterns, earthy tones.',
            'Surreal composition, unexpected scale, dreamlike atmosphere.'
          ];
          for (const ideaId of stubIdeaIds) {
            const derivedSummary = title.title;
            const variation = styleVariations[Math.floor(Math.random() * styleVariations.length)];
            const basePrompt = title.instructions && title.instructions.trim().length > 0
              ? `${title.title}. ${title.instructions}`
              : `${title.title}`;
            const derivedFullPrompt = `${basePrompt}\nStyle variation: ${variation}`;
            await pool.execute(
              'UPDATE ideas SET summary = ?, full_prompt = ? WHERE id = ?',
              [derivedSummary, derivedFullPrompt, ideaId]
            );
            const idea = { id: ideaId, titleId, summary: derivedSummary, fullPrompt: derivedFullPrompt };
            newIdeas.push(idea);
            pendingImageIdeas.push(idea);
            startNextImage();
          }
        } else {
          // Now generate ideas sequentially and immediately start images (pipeline)
          for (const ideaId of stubIdeaIds) {
            const idea = await openRouterService.generateIdeas(
              titleId,
              title.title,
              title.instructions,
              [...prevIdeas, ...newIdeas],
              ideaId
            );
            newIdeas.push(idea);
            pendingImageIdeas.push(idea);
            startNextImage();
          }
        }

        // Wait until all images are finished
        await new Promise((resolve) => {
          const checkDone = () => {
            if (pendingImageIdeas.length === 0 && activeImagePromises.length === 0) resolve();
            else setTimeout(checkDone, 50);
          };
          checkDone();
        });
        jobs.completeJob(job.id);
        sse.publish(titleId, { type: 'jobCompleted', payload: { titleId, jobId: job.id } });
      } catch (err) {
        jobs.failJob(job.id, err);
        sse.publish(titleId, { type: 'jobFailed', payload: { titleId, jobId: job.id, error: String(err?.message || err) } });
      }
    })();
  } catch (error) {
    console.error('Error in generatePaintings (enqueue):', error);
    res.status(500).json({ error: 'Failed to enqueue generation' });
  }
}

// Get status of all paintings for a title
async function getPaintings(req, res) {
  if (!req.user || !req.user.id) {
    console.error('User not authenticated properly');
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { titleId } = req.params;
  const functionStartTime = Date.now(); 
  let stepStartTime = Date.now();

  if (!titleId) {
    return res.status(400).json({ error: 'Title ID is required' });
  }
  console.log(`[Title ID: ${titleId}] getPaintings started.`);

  try {
    const titleCheckParams = [titleId];
    if (titleCheckParams.some(p => p === undefined)) {
      console.error('Attempted to execute query with undefined parameter:', { titleCheckParams });
      return res.status(500).json({ error: 'Internal server error: Invalid query parameter detected' });
    }
    
    const [titleCheck] = await pool.execute(
      'SELECT id FROM titles WHERE id = ?',
      titleCheckParams
    );
    if (titleCheck.length === 0) {
      console.warn(`[Title ID: ${titleId}] Title not found during initial check.`);
      return res.status(404).json({ error: 'Title not found' });
    }
    console.log(`[Title ID: ${titleId}] Title existence check completed in ${Date.now() - stepStartTime}ms.`);
    stepStartTime = Date.now(); 
    
    const paintingQuery = `
      SELECT t.id, t.title_id, t.idea_id, t.image_url, t.status, t.created_at, t.error_message,
             t.used_reference_ids,
             i.summary, i.full_prompt as fullPrompt,
             titles.title as title_text, 
             titles.instructions as title_instructions
      FROM paintings t
      JOIN ideas i ON t.idea_id = i.id
      JOIN titles ON t.title_id = titles.id
      WHERE t.title_id = ?
      ORDER BY t.created_at DESC
    `;
    
    const paintingParams = [titleId];
    if (paintingParams.some(p => p === undefined)) {
      console.error('Attempted to execute query with undefined parameter:', { paintingParams });
      return res.status(500).json({ error: 'Internal server error: Invalid query parameter detected' });
    }
    
    const [paintingRows] = await pool.execute(paintingQuery, paintingParams);
    console.log(`[Title ID: ${titleId}] Initial painting query fetched ${paintingRows ? paintingRows.length : 0} rows in ${Date.now() - stepStartTime}ms.`);
    stepStartTime = Date.now();

    if (!paintingRows || paintingRows.length === 0) {
      console.log(`[Title ID: ${titleId}] No paintings found. Total time: ${Date.now() - functionStartTime}ms.`);
      return res.status(200).json({ paintings: [], referenceDataMap: {} }); // Return empty map
    }

    const allReferenceIds = new Set();
    paintingRows.forEach(row => {
      if (row.used_reference_ids) {
        try {
          const refIds = JSON.parse(row.used_reference_ids);
          if (refIds && Array.isArray(refIds)) {
            refIds.forEach(id => {
              if (id != null) allReferenceIds.add(id);
            });
          }
        } catch (e) {
          console.error(`[Title ID: ${titleId}] Error parsing used_reference_ids for painting ${row.id} (value: '${row.used_reference_ids}'):`, e.message);
        }
      }
    });
    console.log(`[Title ID: ${titleId}] Collected ${allReferenceIds.size} unique reference IDs in ${Date.now() - stepStartTime}ms.`);
    stepStartTime = Date.now();

    let serverReferenceDataMap = {}; // Changed to object for JSON response
    const uniqueRefIdsArray = Array.from(allReferenceIds);

    if (uniqueRefIdsArray.length > 0) {
      try {
        const placeholders = uniqueRefIdsArray.map(() => '?').join(',');
        
        // Validate all parameters before executing query
        if (uniqueRefIdsArray.some(p => p === undefined)) {
          console.error('Attempted to execute query with undefined parameter in reference IDs:', { uniqueRefIdsArray });
          // Continue without reference data rather than failing the entire request
        } else {
          const [actualRefDataRows] = await pool.execute(
            `SELECT id, image_data FROM references2 WHERE id IN (${placeholders})`,
            uniqueRefIdsArray
          );
          actualRefDataRows.forEach(refRow => {
            serverReferenceDataMap[refRow.id] = refRow.image_data; // Populate object
          });
          console.log(`[Title ID: ${titleId}] Bulk fetched ${Object.keys(serverReferenceDataMap).length} reference data items in ${Date.now() - stepStartTime}ms.`);
        }
      } catch (refQueryError) {
          console.error(`[Title ID: ${titleId}] Error fetching bulk reference data:`, refQueryError);
          console.log(`[Title ID: ${titleId}] Proceeding without detailed reference images due to bulk fetch error. Time before error: ${Date.now() - stepStartTime}ms.`);
      }
    }
    stepStartTime = Date.now();

    const paintingsWithDetails = paintingRows.map(row => {
      let usedRefIdsList = [];
      let referenceCount = 0;

      if (row.used_reference_ids) {
        try {
          const refIds = JSON.parse(row.used_reference_ids);
          if (refIds && Array.isArray(refIds) && refIds.length > 0) {
            usedRefIdsList = refIds.filter(id => id != null && serverReferenceDataMap.hasOwnProperty(id));
            referenceCount = usedRefIdsList.length;
          }
        } catch (e) { /* Error already logged */ }
      }
      
      const promptDetails = {
        summary: row.summary || '',
        title: row.title_text || 'Unknown Title',
        instructions: row.title_instructions || 'No custom instructions provided',
        referenceCount: referenceCount,
        referenceImages: usedRefIdsList, // Now an array of IDs
        fullPrompt: row.fullPrompt || ''
      };

      return {
        id: row.id,
        idea_id: row.idea_id,
        title_id: row.title_id,
        image_url: row.image_url || '',
        status: row.status || 'unknown',
        created_at: row.created_at || new Date(),
        error_message: row.error_message || '',
        summary: row.summary || '',
        promptDetails: promptDetails
      };
    });
    console.log(`[Title ID: ${titleId}] Mapped paintings to details in ${Date.now() - stepStartTime}ms.`);
    
    console.log(`[Title ID: ${titleId}] getPaintings completed successfully in ${Date.now() - functionStartTime}ms.`);
    res.status(200).json({ paintings: paintingsWithDetails, referenceDataMap: serverReferenceDataMap });

  } catch (error) {
    console.error(`[Title ID: ${titleId}] Critical error in getPaintings (total time: ${Date.now() - functionStartTime}ms):`, error);
    res.status(500).json({ error: `Failed to get paintings: ${error.message}` });
  }
}

// SSE stream endpoint
async function streamPaintings(req, res) {
  if (!req.user || !req.user.id) {
    console.error('User not authenticated properly');
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { titleId } = req.params;
  if (!titleId) {
    return res.status(400).json({ error: 'Title ID is required' });
  }

  // Headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  // Subscribe and send heartbeat
  sse.subscribe(titleId, res);

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sse.unsubscribe(titleId, res);
    res.end();
  });
}

// Job status endpoint
async function getJobStatus(req, res) {
  if (!req.user || !req.user.id) {
    console.error('User not authenticated properly');
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { jobId } = req.params;
  if (!jobId) {
    return res.status(400).json({ error: 'Job ID is required' });
  }
  const job = require('../services/jobQueue').getJob(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.status(200).json({ job });
}

module.exports = {
  generatePaintings,
  getPaintings,
  streamPaintings,
  getJobStatus
}; 