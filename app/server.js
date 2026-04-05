require('dotenv').config();

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    console.error('FATAL: SESSION_SECRET must be set in production');
    process.exit(1);
}

const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const app = express();
const port = process.env.PORT || 3000;

const rpID = process.env.RP_ID || 'localhost';
const rpName = 'Rossoa Tracker';
const origin = process.env.ORIGIN || `http://localhost:${port}`;

// Database connection
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'rossoa_tracker',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
});

// Security
app.use(helmet({ contentSecurityPolicy: false }));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: 'Příliš mnoho pokusů o přihlášení, zkuste to prosím znovu za 15 minut.'
});

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'rossoa-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Auth middleware
const requireAuth = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
};

// Make user info available to all views
app.use((req, res, next) => {
    res.locals.userId = req.session.userId;
    res.locals.username = req.session.username;
    next();
});

// ============ AUTH ROUTES ============

// Login page
app.get('/login', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/');
    }
    res.render('login', { error: null });
});

// Login POST
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE username = $1',
            [username]
        );

        if (result.rows.length === 0) {
            return res.render('login', { error: 'Nesprávné uživatelské jméno nebo heslo' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.render('login', { error: 'Nesprávné uživatelské jméno nebo heslo' });
        }

        req.session.userId = user.id;
        req.session.username = user.username;
        res.redirect('/');
    } catch (err) {
        console.error('Login error:', err);
        res.render('login', { error: 'Chyba při přihlášení' });
    }
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// ============ DASHBOARD ============

app.get('/', requireAuth, async (req, res) => {
    try {
        const [inProgress, planned, finished, activeWorkers, totals, activeConstructions, workers, materialTypes, serviceTypes] = await Promise.all([
            pool.query("SELECT COUNT(*) FROM constructions WHERE state = 'In progress'"),
            pool.query("SELECT COUNT(*) FROM constructions WHERE state = 'Planned'"),
            pool.query("SELECT COUNT(*) FROM constructions WHERE state = 'Finished'"),
            pool.query("SELECT COUNT(*) FROM workers WHERE state = 'Zamestnan'"),
            pool.query(`
                SELECT
                    COALESCE(SUM(c.price), 0) AS total_price,
                    COALESCE(SUM(
                        COALESCE((SELECT SUM(price) FROM materials_services WHERE construction_id = c.id), 0) +
                        COALESCE((SELECT SUM(price) FROM works WHERE construction_id = c.id), 0)
                    ), 0) AS total_expenses
                FROM constructions c
            `),
            pool.query(`
                SELECT c.*,
                    COALESCE((SELECT SUM(price) FROM materials_services WHERE construction_id = c.id), 0) as materials_total,
                    COALESCE((SELECT SUM(price) FROM works WHERE construction_id = c.id), 0) as works_total
                FROM constructions c
                WHERE c.state IN ('In progress', 'Planned')
                ORDER BY CASE c.state WHEN 'In progress' THEN 0 ELSE 1 END, c.created_at DESC
            `),
            pool.query("SELECT id, name FROM workers WHERE state = 'Zamestnan' ORDER BY name"),
            pool.query("SELECT name, unit FROM material_types WHERE archived = FALSE ORDER BY name"),
            pool.query("SELECT name FROM service_types WHERE archived = FALSE ORDER BY name"),
        ]);

        const totalPrice = parseFloat(totals.rows[0].total_price);
        const totalExpenses = parseFloat(totals.rows[0].total_expenses);

        const constructionIds = activeConstructions.rows.map(c => c.id);
        let recordsByConstruction = {};
        if (constructionIds.length > 0) {
            const recordsRes = await pool.query(`
                (SELECT ms.id, ms.construction_id, ms.date,
                  CONCAT(ms.category, ' – ', ms.type) as description,
                  ms.price, 'material' as kind,
                  ms.quantity, COALESCE(mt.unit, '') as unit,
                  ms.category as raw_category, ms.type as raw_type, NULL::integer as worker_id, '' as worker_name
                FROM materials_services ms
                LEFT JOIN material_types mt ON LOWER(ms.type) = LOWER(mt.name) AND ms.category = 'Material'
                WHERE ms.construction_id = ANY($1))
                UNION ALL
                (SELECT id, construction_id, date, CONCAT('Práce – ', type) as description, price, 'work' as kind,
                  NULL as quantity, '' as unit,
                  '' as raw_category, type as raw_type, worker_id, COALESCE(worker_name, '') as worker_name
                FROM works WHERE construction_id = ANY($1))
                ORDER BY date DESC
            `, [constructionIds]);
            recordsRes.rows.forEach(r => {
                if (!recordsByConstruction[r.construction_id]) recordsByConstruction[r.construction_id] = [];
                if (recordsByConstruction[r.construction_id].length < 10) {
                    if (r.quantity != null) {
                        const qty = parseFloat(r.quantity);
                        const qtyStr = qty % 1 === 0 ? qty.toString() : parseFloat(qty.toFixed(10)).toString();
                        r.description += ', ' + qtyStr + (r.unit ? ' ' + r.unit : '');
                    }
                    if (r.kind === 'work' && r.worker_name) {
                        r.description += ', ' + r.worker_name;
                    }
                    recordsByConstruction[r.construction_id].push(r);
                }
            });
        }

        const constructions = activeConstructions.rows.map(c => ({
            ...c,
            total_expenses: parseFloat(c.materials_total) + parseFloat(c.works_total),
            records: recordsByConstruction[c.id] || [],
        }));

        res.render('dashboard', {
            inProgress: inProgress.rows[0].count,
            planned: planned.rows[0].count,
            finished: finished.rows[0].count,
            activeWorkers: activeWorkers.rows[0].count,
            totalPrice,
            totalExpenses,
            totalProfit: totalPrice - totalExpenses,
            constructions,
            workers: workers.rows,
            materialTypes: materialTypes.rows,
            serviceTypes: serviceTypes.rows,
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.render('dashboard', {
            inProgress: 0, planned: 0, finished: 0, activeWorkers: 0,
            totalPrice: 0, totalExpenses: 0, totalProfit: 0,
            constructions: [], workers: [], materialTypes: [], serviceTypes: [],
        });
    }
});

// ============ WORKERS ROUTES ============

app.get('/workers', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT w.*,
                (SELECT COUNT(*) FROM works WHERE worker_id = w.id) as work_count
            FROM workers w
            ORDER BY w.state DESC, w.name ASC
        `);
        res.render('workers', { workers: result.rows });
    } catch (err) {
        console.error('Workers error:', err);
        res.render('workers', { workers: [] });
    }
});

app.post('/workers', requireAuth, async (req, res) => {
    const { name, state } = req.body;
    try {
        if (req.body.id) {
            // Update
            const archivedAt = state === 'Propusten' ? 'NOW()' : 'NULL';
            await pool.query(
                `UPDATE workers SET name = $1, state = $2, archived_at = ${state === 'Propusten' ? 'NOW()' : 'NULL'} WHERE id = $3`,
                [name, state, req.body.id]
            );
        } else {
            // Create
            await pool.query(
                'INSERT INTO workers (name, state) VALUES ($1, $2)',
                [name, state || 'Zamestnan']
            );
        }
        res.redirect('/workers');
    } catch (err) {
        console.error('Workers POST error:', err);
        res.redirect('/workers');
    }
});

app.post('/workers/delete/:id', requireAuth, async (req, res) => {
    try {
        // Check if worker has work records
        const workCheck = await pool.query('SELECT COUNT(*) FROM works WHERE worker_id = $1', [req.params.id]);
        const hasWorkRecords = parseInt(workCheck.rows[0].count) > 0;

        if (hasWorkRecords) {
            // Soft delete - set state to Propusten
            await pool.query("UPDATE workers SET state = 'Propusten' WHERE id = $1", [req.params.id]);
        } else {
            // Hard delete - worker not used in any work records
            await pool.query('DELETE FROM workers WHERE id = $1', [req.params.id]);
        }
        res.redirect('/workers');
    } catch (err) {
        console.error('Delete worker error:', err);
        res.redirect('/workers');
    }
});

// ============ CONSTRUCTIONS ROUTES ============

app.get('/constructions', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.*,
                COALESCE((SELECT SUM(price) FROM materials_services WHERE construction_id = c.id), 0) as materials_total,
                COALESCE((SELECT SUM(price) FROM works WHERE construction_id = c.id), 0) as works_total
            FROM constructions c
            ORDER BY c.created_at DESC
        `);

        // Calculate totals for each construction
        const constructions = result.rows.map(c => ({
            ...c,
            total_expenses: parseFloat(c.materials_total) + parseFloat(c.works_total),
            revenue: parseFloat(c.price) - (parseFloat(c.materials_total) + parseFloat(c.works_total))
        }));

        res.render('constructions', { constructions });
    } catch (err) {
        console.error('Constructions error:', err);
        res.render('constructions', { constructions: [] });
    }
});

// Compute state from dates
const computeState = (beginningDate, endDate) => {
    if (endDate) return 'Finished';
    if (beginningDate) return 'In progress';
    return 'Planned';
};

app.post('/constructions', requireAuth, async (req, res) => {
    const { name, customer, beginning_date, end_date, price, redirect_to } = req.body;
    const state = computeState(beginning_date, end_date);
    try {
        if (req.body.id) {
            await pool.query(
                `UPDATE constructions SET name = $1, customer = $2, state = $3, beginning_date = $4, end_date = $5, price = $6 WHERE id = $7`,
                [name, customer, state, beginning_date || null, end_date || null, price || 0, req.body.id]
            );
        } else {
            await pool.query(
                'INSERT INTO constructions (name, customer, state, beginning_date, end_date, price) VALUES ($1, $2, $3, $4, $5, $6)',
                [name, customer, state, beginning_date || null, end_date || null, price || 0]
            );
        }
        res.redirect(redirect_to || '/constructions');
    } catch (err) {
        console.error('Constructions POST error:', err);
        res.redirect(redirect_to || '/constructions');
    }
});

app.post('/constructions/delete/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM constructions WHERE id = $1', [req.params.id]);
        res.redirect('/constructions');
    } catch (err) {
        console.error('Delete construction error:', err);
        res.redirect('/constructions');
    }
});

// ============ MATERIALS/SERVICES ROUTES ============

app.get('/materials', requireAuth, async (req, res) => {
    try {
        const constructionId = req.query.construction_id;

        let query = `
            SELECT ms.*, c.name as construction_name, mt.unit as material_unit
            FROM materials_services ms
            LEFT JOIN constructions c ON ms.construction_id = c.id
            LEFT JOIN material_types mt ON LOWER(ms.type) = LOWER(mt.name) AND ms.category = 'Material'
        `;
        let params = [];

        if (constructionId) {
            query += ' WHERE ms.construction_id = $1';
            params.push(constructionId);
        }

        query += ' ORDER BY ms.date DESC';

        const result = await pool.query(query, params);

        // Get constructions for dropdown (only Planned or In progress)
        const constructions = await pool.query(
            "SELECT id, name FROM constructions WHERE state IN ('Planned', 'In progress') ORDER BY name"
        );

        // Get material and service types (only non-archived)
        const materialTypesResult = await pool.query('SELECT * FROM material_types WHERE archived = FALSE ORDER BY name');
        const serviceTypesResult = await pool.query('SELECT * FROM service_types WHERE archived = FALSE ORDER BY name');

        res.render('materials', {
            materials: result.rows,
            constructions: constructionId ? constructions.rows.filter(c => c.id == constructionId) : constructions.rows,
            selectedConstruction: constructionId,
            materialTypes: materialTypesResult.rows,
            serviceTypes: serviceTypesResult.rows
        });
    } catch (err) {
        console.error('Materials error:', err);
        res.render('materials', { materials: [], constructions: [], selectedConstruction: null, materialTypes: [], serviceTypes: [] });
    }
});

app.post('/materials', requireAuth, async (req, res) => {
    const { construction_id, date, category, type, type_custom, new_type_unit, price, quantity } = req.body;
    const finalType = req.body.is_custom_type === 'true' ? type_custom : type;
    const finalQuantity = category === 'Material' && quantity ? parseFloat(quantity) : null;
    try {
        // Handle custom types - check for archived match first or create new
        if (req.body.is_custom_type === 'true' && finalType) {
            if (category === 'Material') {
                const existing = await pool.query('SELECT id FROM material_types WHERE LOWER(name) = LOWER($1)', [finalType]);
                if (existing.rows.length > 0) {
                    await pool.query('UPDATE material_types SET archived = FALSE WHERE id = $1', [existing.rows[0].id]);
                } else {
                    await pool.query('INSERT INTO material_types (name, unit) VALUES ($1, $2)', [finalType, new_type_unit || null]);
                }
            } else if (category === 'Sluzba') {
                const existing = await pool.query('SELECT id FROM service_types WHERE LOWER(name) = LOWER($1)', [finalType]);
                if (existing.rows.length > 0) {
                    await pool.query('UPDATE service_types SET archived = FALSE WHERE id = $1', [existing.rows[0].id]);
                } else {
                    await pool.query('INSERT INTO service_types (name) VALUES ($1)', [finalType]);
                }
            }
        }

        if (req.body.id) {
            await pool.query(
                `UPDATE materials_services SET construction_id = $1, date = $2, category = $3, type = $4, price = $5, quantity = $6 WHERE id = $7`,
                [construction_id, date, category, finalType, price, finalQuantity, req.body.id]
            );
        } else {
            await pool.query(
                'INSERT INTO materials_services (construction_id, date, category, type, price, quantity) VALUES ($1, $2, $3, $4, $5, $6)',
                [construction_id, date, category, finalType, price, finalQuantity]
            );
        }
        const redirectUrl = req.body.redirect_to || (construction_id ? `/materials?construction_id=${construction_id}` : '/materials');
        res.redirect(redirectUrl);
    } catch (err) {
        console.error('Materials POST error:', err);
        res.redirect('/materials');
    }
});

// ============ QUICK RECORD API ============

app.post('/api/quick-record', requireAuth, async (req, res) => {
    const { construction_id, record_type, category, type, worker_id, date, price } = req.body;
    try {
        if (record_type === 'work') {
            const workerRes = await pool.query('SELECT name FROM workers WHERE id = $1', [worker_id]);
            const workerName = workerRes.rows[0] ? workerRes.rows[0].name : null;
            const constrRes = await pool.query('SELECT name FROM constructions WHERE id = $1', [construction_id]);
            const constructionName = constrRes.rows[0] ? constrRes.rows[0].name : null;
            await pool.query(
                'INSERT INTO works (construction_id, construction_name, date, type, worker_id, worker_name, price) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [construction_id, constructionName, date, type, worker_id || null, workerName, price]
            );
        } else {
            await pool.query(
                'INSERT INTO materials_services (construction_id, date, category, type, price) VALUES ($1, $2, $3, $4, $5)',
                [construction_id, date, category, type, price]
            );
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Quick record error:', err);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

app.post('/api/edit-record', requireAuth, async (req, res) => {
    const { id, kind, description, date, price } = req.body;
    try {
        if (kind === 'work') {
            await pool.query('UPDATE works SET type = $1, date = $2, price = $3 WHERE id = $4', [description, date, price, id]);
        } else {
            await pool.query('UPDATE materials_services SET type = $1, date = $2, price = $3 WHERE id = $4', [description, date, price, id]);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Edit record error:', err);
        res.status(500).json({ success: false });
    }
});

app.post('/materials/delete/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM materials_services WHERE id = $1', [req.params.id]);
        res.redirect('/materials');
    } catch (err) {
        console.error('Delete material error:', err);
        res.redirect('/materials');
    }
});

// ============ SETTINGS ROUTES ============

app.get('/settings', requireAuth, async (req, res) => {
    const [materialTypes, serviceTypes, passkeys] = await Promise.all([
        pool.query(`
            SELECT mt.*, EXISTS(
                SELECT 1 FROM materials_services WHERE LOWER(type) = LOWER(mt.name)
            ) as used
            FROM material_types mt ORDER BY name
        `),
        pool.query(`
            SELECT st.*, EXISTS(
                SELECT 1 FROM materials_services WHERE LOWER(type) = LOWER(st.name)
            ) as used
            FROM service_types st ORDER BY name
        `),
        pool.query('SELECT id, created_at FROM passkey_credentials WHERE user_id = $1 ORDER BY created_at DESC', [req.session.userId]),
    ]);
    res.render('settings', {
        materialTypes: materialTypes.rows,
        serviceTypes: serviceTypes.rows,
        passkeys: passkeys.rows,
    });
});

// ============ API ROUTES ============

app.get('/api/search-types', requireAuth, async (req, res) => {
    const { q, category } = req.query;
    if (!q || q.length < 2) return res.json([]);

    try {
        if (category === 'Material') {
            const result = await pool.query(
                'SELECT id, name, unit FROM material_types WHERE archived = TRUE AND LOWER(name) LIKE LOWER($1) ORDER BY name',
                [`%${q}%`]
            );
            res.json(result.rows);
        } else if (category === 'Sluzba') {
            const result = await pool.query(
                'SELECT id, name FROM service_types WHERE archived = TRUE AND LOWER(name) LIKE LOWER($1) ORDER BY name',
                [`%${q}%`]
            );
            res.json(result.rows);
        } else {
            res.json([]);
        }
    } catch (err) {
        console.error('Search types error:', err);
        res.json([]);
    }
});

app.post('/settings/material-types', requireAuth, async (req, res) => {
    const { new_type, new_unit, delete_type, restore_type } = req.body;
    try {
        if (new_type) {
            // Check if exists (active or archived)
            const existing = await pool.query('SELECT id, archived FROM material_types WHERE LOWER(name) = LOWER($1)', [new_type]);
            if (existing.rows.length > 0) {
                if (existing.rows[0].archived) {
                    // Restore archived
                    await pool.query('UPDATE material_types SET archived = FALSE WHERE id = $1', [existing.rows[0].id]);
                }
            } else {
                await pool.query('INSERT INTO material_types (name, unit) VALUES ($1, $2)', [new_type, new_unit || null]);
            }
        }
        if (delete_type) {
            await pool.query('UPDATE material_types SET archived = TRUE WHERE id = $1', [delete_type]);
        }
        if (restore_type) {
            await pool.query('UPDATE material_types SET archived = FALSE WHERE id = $1', [restore_type]);
        }
    } catch (err) {
        console.error('Settings material-types error:', err);
    }
    res.redirect('/settings');
});

app.post('/settings/material-types/delete/:id', requireAuth, async (req, res) => {
    try {
        const typeRow = await pool.query('SELECT name FROM material_types WHERE id = $1', [req.params.id]);
        if (typeRow.rows.length > 0) {
            const used = await pool.query(
                'SELECT COUNT(*) FROM materials_services WHERE LOWER(type) = LOWER($1)',
                [typeRow.rows[0].name]
            );
            if (parseInt(used.rows[0].count) === 0) {
                await pool.query('DELETE FROM material_types WHERE id = $1', [req.params.id]);
            }
        }
    } catch (err) {
        console.error('Delete material-type error:', err);
    }
    res.redirect('/settings');
});

app.post('/settings/service-types', requireAuth, async (req, res) => {
    const { new_type, delete_type, restore_type } = req.body;
    try {
        if (new_type) {
            const existing = await pool.query('SELECT id, archived FROM service_types WHERE LOWER(name) = LOWER($1)', [new_type]);
            if (existing.rows.length > 0) {
                if (existing.rows[0].archived) {
                    await pool.query('UPDATE service_types SET archived = FALSE WHERE id = $1', [existing.rows[0].id]);
                }
            } else {
                await pool.query('INSERT INTO service_types (name) VALUES ($1)', [new_type]);
            }
        }
        if (delete_type) {
            await pool.query('UPDATE service_types SET archived = TRUE WHERE id = $1', [delete_type]);
        }
        if (restore_type) {
            await pool.query('UPDATE service_types SET archived = FALSE WHERE id = $1', [restore_type]);
        }
    } catch (err) {
        console.error('Settings service-types error:', err);
    }
    res.redirect('/settings');
});

app.post('/settings/service-types/delete/:id', requireAuth, async (req, res) => {
    try {
        const typeRow = await pool.query('SELECT name FROM service_types WHERE id = $1', [req.params.id]);
        if (typeRow.rows.length > 0) {
            const used = await pool.query(
                'SELECT COUNT(*) FROM materials_services WHERE LOWER(type) = LOWER($1)',
                [typeRow.rows[0].name]
            );
            if (parseInt(used.rows[0].count) === 0) {
                await pool.query('DELETE FROM service_types WHERE id = $1', [req.params.id]);
            }
        }
    } catch (err) {
        console.error('Delete service-type error:', err);
    }
    res.redirect('/settings');
});

// ============ WORKS ROUTES ============

app.get('/works', requireAuth, async (req, res) => {
    try {
        const constructionId = req.query.construction_id;

        let query = `
            SELECT w.*, c.name as construction_name
            FROM works w
            LEFT JOIN constructions c ON w.construction_id = c.id
        `;
        let params = [];

        if (constructionId) {
            query += ' WHERE w.construction_id = $1';
            params.push(constructionId);
        }

        query += ' ORDER BY w.date DESC';

        const result = await pool.query(query, params);

        // Get constructions for dropdown (only Planned or In progress)
        const constructions = await pool.query(
            "SELECT id, name FROM constructions WHERE state IN ('Planned', 'In progress') ORDER BY name"
        );

        // Get active workers (Zamestnan) for dropdown
        const workers = await pool.query(
            "SELECT id, name FROM workers WHERE state = 'Zamestnan' ORDER BY name"
        );

        // Get unique work types
        const workTypes = await pool.query(`
            SELECT DISTINCT type FROM works ORDER BY type
        `);

        res.render('works', {
            works: result.rows,
            constructions: constructionId ? constructions.rows.filter(c => c.id == constructionId) : constructions.rows,
            workers: workers.rows,
            workTypes: workTypes.rows.map(r => r.type),
            selectedConstruction: constructionId
        });
    } catch (err) {
        console.error('Works error:', err);
        res.render('works', { works: [], constructions: [], workers: [], workTypes: [], selectedConstruction: null });
    }
});

app.post('/works', requireAuth, async (req, res) => {
    const { construction_id, date, type, price } = req.body;
    const worker_id = req.body.worker_id || null;
    try {
        // Get worker and construction names
        const workerResult = worker_id ? await pool.query('SELECT name FROM workers WHERE id = $1', [worker_id]) : { rows: [] };
        const workerName = workerResult.rows.length > 0 ? workerResult.rows[0].name : null;
        const constrResult = await pool.query('SELECT name FROM constructions WHERE id = $1', [construction_id]);
        const constructionName = constrResult.rows.length > 0 ? constrResult.rows[0].name : null;

        if (req.body.id) {
            await pool.query(
                `UPDATE works SET construction_id = $1, construction_name = $2, date = $3, type = $4, worker_id = $5, worker_name = $6, price = $7 WHERE id = $8`,
                [construction_id, constructionName, date, type, worker_id || null, workerName, price, req.body.id]
            );
        } else {
            await pool.query(
                'INSERT INTO works (construction_id, construction_name, date, type, worker_id, worker_name, price) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [construction_id, constructionName, date, type, worker_id || null, workerName, price]
            );
        }
        const redirectUrl = req.body.redirect_to || (construction_id ? `/works?construction_id=${construction_id}` : '/works');
        res.redirect(redirectUrl);
    } catch (err) {
        console.error('Works POST error:', err);
        res.redirect('/works');
    }
});

app.post('/works/delete/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM works WHERE id = $1', [req.params.id]);
        res.redirect('/works');
    } catch (err) {
        console.error('Delete work error:', err);
        res.redirect('/works');
    }
});

// ============ REPORTS ROUTES ============

app.get('/reports', requireAuth, async (req, res) => {
    const { tab, construction_id, worker_id, from, to, type_filter } = req.query;
    try {
        const [constructionsRes, workersRes, typeFiltersRes] = await Promise.all([
            pool.query('SELECT id, name FROM constructions ORDER BY created_at DESC'),
            pool.query('SELECT id, name FROM workers ORDER BY name'),
            pool.query('SELECT DISTINCT type FROM materials_services ORDER BY type'),
        ]);

        let reportData = null;

        if (tab === 'construction' && construction_id) {
            const [constrRes, matRes, workRes] = await Promise.all([
                pool.query('SELECT * FROM constructions WHERE id = $1', [construction_id]),
                pool.query(`
                    SELECT ms.category, ms.type,
                        SUM(CASE WHEN ms.category = 'Material' THEN ms.quantity ELSE NULL END) as total_qty,
                        COALESCE(mt.unit, '') as unit,
                        SUM(ms.price) as total_price
                    FROM materials_services ms
                    LEFT JOIN material_types mt ON LOWER(ms.type) = LOWER(mt.name) AND ms.category = 'Material'
                    WHERE ms.construction_id = $1
                    GROUP BY ms.category, ms.type, mt.unit
                    ORDER BY ms.category, ms.type
                `, [construction_id]),
                pool.query(`
                    SELECT COALESCE(worker_name, '—') as worker_name,
                        COUNT(*) as count, SUM(price) as total_price
                    FROM works WHERE construction_id = $1
                    GROUP BY worker_name ORDER BY worker_name
                `, [construction_id]),
            ]);
            if (constrRes.rows.length > 0) {
                const c = constrRes.rows[0];
                const matTotal = matRes.rows.reduce((s, r) => s + parseFloat(r.total_price), 0);
                const workTotal = workRes.rows.reduce((s, r) => s + parseFloat(r.total_price), 0);
                reportData = {
                    type: 'construction', construction: c,
                    matRows: matRes.rows, workRows: workRes.rows,
                    matTotal, workTotal,
                    totalExpenses: matTotal + workTotal,
                    profit: parseFloat(c.price || 0) - (matTotal + workTotal),
                };
            }
        }

        else if (tab === 'worker' && worker_id) {
            const params = [worker_id];
            let where = 'WHERE w.worker_id = $1';
            if (from) { params.push(from); where += ` AND w.date >= $${params.length}`; }
            if (to)   { params.push(to);   where += ` AND w.date <= $${params.length}`; }
            const [workerRes, worksRes] = await Promise.all([
                pool.query('SELECT * FROM workers WHERE id = $1', [worker_id]),
                pool.query(`
                    SELECT w.*, c.name as construction_name
                    FROM works w LEFT JOIN constructions c ON w.construction_id = c.id
                    ${where} ORDER BY w.date DESC
                `, params),
            ]);
            if (workerRes.rows.length > 0) {
                const byConstruction = {};
                worksRes.rows.forEach(w => {
                    const key = w.construction_id;
                    if (!byConstruction[key]) byConstruction[key] = { name: w.construction_name || '—', works: [], total: 0 };
                    byConstruction[key].works.push(w);
                    byConstruction[key].total += parseFloat(w.price);
                });
                reportData = {
                    type: 'worker', worker: workerRes.rows[0],
                    byConstruction: Object.values(byConstruction),
                    total: worksRes.rows.reduce((s, w) => s + parseFloat(w.price), 0),
                    count: worksRes.rows.length, from, to,
                };
            }
        }

        else if (tab === 'period' && from && to) {
            const matParams = [from, to];
            let matWhere = 'WHERE ms.date >= $1 AND ms.date <= $2';
            if (construction_id) { matParams.push(construction_id); matWhere += ` AND ms.construction_id = $${matParams.length}`; }
            if (type_filter)     { matParams.push(type_filter);     matWhere += ` AND LOWER(ms.type) = LOWER($${matParams.length})`; }

            const workParams = [from, to];
            let workWhere = 'WHERE w.date >= $1 AND w.date <= $2';
            if (construction_id) { workParams.push(construction_id); workWhere += ` AND w.construction_id = $${workParams.length}`; }
            if (worker_id)       { workParams.push(worker_id);       workWhere += ` AND w.worker_id = $${workParams.length}`; }

            const [matRes, workRes] = await Promise.all([
                pool.query(`
                    SELECT ms.*, c.name as construction_name
                    FROM materials_services ms JOIN constructions c ON ms.construction_id = c.id
                    ${matWhere} ORDER BY ms.date DESC
                `, matParams),
                type_filter ? Promise.resolve({ rows: [] }) : pool.query(`
                    SELECT w.*, c.name as construction_name
                    FROM works w JOIN constructions c ON w.construction_id = c.id
                    ${workWhere} ORDER BY w.date DESC
                `, workParams),
            ]);

            const byConstruction = {};
            matRes.rows.forEach(r => {
                if (!byConstruction[r.construction_id]) byConstruction[r.construction_id] = { name: r.construction_name, materials: [], works: [], matTotal: 0, workTotal: 0 };
                byConstruction[r.construction_id].materials.push(r);
                byConstruction[r.construction_id].matTotal += parseFloat(r.price);
            });
            workRes.rows.forEach(r => {
                if (!byConstruction[r.construction_id]) byConstruction[r.construction_id] = { name: r.construction_name, materials: [], works: [], matTotal: 0, workTotal: 0 };
                byConstruction[r.construction_id].works.push(r);
                byConstruction[r.construction_id].workTotal += parseFloat(r.price);
            });
            const groups = Object.values(byConstruction).map(g => ({ ...g, total: g.matTotal + g.workTotal }));
            const selectedWorker = worker_id ? workersRes.rows.find(w => w.id == worker_id) : null;
            const selectedConstr = construction_id ? constructionsRes.rows.find(c => c.id == construction_id) : null;
            reportData = {
                type: 'period', from, to,
                typeFilter: type_filter || null,
                workerFilter: selectedWorker || null,
                constructionFilter: selectedConstr || null,
                groups,
                matTotal: matRes.rows.reduce((s, r) => s + parseFloat(r.price), 0),
                workTotal: workRes.rows.reduce((s, r) => s + parseFloat(r.price), 0),
                total: matRes.rows.reduce((s, r) => s + parseFloat(r.price), 0) + workRes.rows.reduce((s, r) => s + parseFloat(r.price), 0),
            };
        }

        res.render('reports', {
            tab: tab || 'construction',
            constructions: constructionsRes.rows,
            workers: workersRes.rows,
            typeFilters: typeFiltersRes.rows.map(r => r.type),
            selectedConstruction: construction_id || '',
            selectedWorker: worker_id || '',
            from: from || '', to: to || '',
            typeFilter: type_filter || '',
            reportData,
        });
    } catch (err) {
        console.error('Reports error:', err);
        res.render('reports', {
            tab: tab || 'construction',
            constructions: [], workers: [], typeFilters: [],
            selectedConstruction: '', selectedWorker: '', from: '', to: '', typeFilter: '',
            reportData: null,
        });
    }
});

// ============ PASSKEY ROUTES ============

// Generate registration options (user must be logged in)
app.get('/auth/passkey/register-options', requireAuth, async (req, res) => {
    try {
        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
        const user = userResult.rows[0];

        const existingCreds = await pool.query(
            'SELECT credential_id FROM passkey_credentials WHERE user_id = $1', [user.id]
        );

        const options = await generateRegistrationOptions({
            rpName,
            rpID,
            userID: Buffer.from(user.id.toString()),
            userName: user.username,
            attestationType: 'none',
            excludeCredentials: existingCreds.rows.map(c => ({ id: c.credential_id, type: 'public-key' })),
            authenticatorSelection: { userVerification: 'required', residentKey: 'required' },
        });

        req.session.registrationChallenge = options.challenge;
        await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
        res.json(options);
    } catch (err) {
        console.error('Passkey register options error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Verify and store registration
app.post('/auth/passkey/register-verify', requireAuth, async (req, res) => {
    try {
        const expectedChallenge = req.session.registrationChallenge;
        if (!expectedChallenge) return res.status(400).json({ error: 'No challenge found' });

        const { verified, registrationInfo } = await verifyRegistrationResponse({
            response: req.body,
            expectedChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
        });

        if (verified && registrationInfo) {
            const { credential } = registrationInfo;
            await pool.query(
                'INSERT INTO passkey_credentials (user_id, credential_id, public_key, counter) VALUES ($1, $2, $3, $4) ON CONFLICT (credential_id) DO UPDATE SET counter = $4',
                [req.session.userId, credential.id, Buffer.from(credential.publicKey).toString('base64'), credential.counter]
            );
            delete req.session.registrationChallenge;
            res.json({ verified: true });
        } else {
            res.status(400).json({ verified: false });
        }
    } catch (err) {
        console.error('Passkey register verify error:', err);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// Generate authentication options (public)
app.get('/auth/passkey/login-options', async (req, res) => {
    try {
        const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
        req.session.authChallenge = options.challenge;
        await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
        res.json(options);
    } catch (err) {
        console.error('Passkey login options error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Verify authentication and create session
app.post('/auth/passkey/login-verify', async (req, res) => {
    try {
        const expectedChallenge = req.session.authChallenge;
        if (!expectedChallenge) return res.status(400).json({ error: 'No challenge found' });

        const credResult = await pool.query(
            `SELECT pc.*, u.id as uid, u.username
             FROM passkey_credentials pc
             JOIN users u ON pc.user_id = u.id
             WHERE pc.credential_id = $1`,
            [req.body.id]
        );

        if (credResult.rows.length === 0) return res.status(400).json({ error: 'Credential not found' });

        const cred = credResult.rows[0];

        const { verified, authenticationInfo } = await verifyAuthenticationResponse({
            response: req.body,
            expectedChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential: {
                id: cred.credential_id,
                publicKey: Buffer.from(cred.public_key, 'base64'),
                counter: parseInt(cred.counter),
            },
        });

        if (verified) {
            await pool.query('UPDATE passkey_credentials SET counter = $1 WHERE credential_id = $2',
                [authenticationInfo.newCounter, cred.credential_id]);
            delete req.session.authChallenge;
            req.session.userId = cred.uid;
            req.session.username = cred.username;
            res.json({ verified: true });
        } else {
            res.status(400).json({ verified: false });
        }
    } catch (err) {
        console.error('Passkey login verify error:', err);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// Delete a passkey
app.post('/auth/passkey/delete/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM passkey_credentials WHERE id = $1 AND user_id = $2',
            [req.params.id, req.session.userId]);
    } catch (err) {
        console.error('Delete passkey error:', err);
    }
    res.redirect('/settings');
});

// Initialize default admin user on startup
async function initAdmin() {
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);
        if (result.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await pool.query(
                'INSERT INTO users (username, password) VALUES ($1, $2)',
                ['admin', hashedPassword]
            );
            console.log('Default admin user created (username: admin, password: admin123)');
        }
    } catch (err) {
        console.log('Note: Could not create admin user (database may not be ready)');
    }
}

async function initPasskeyTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS passkey_credentials (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                credential_id TEXT UNIQUE NOT NULL,
                public_key TEXT NOT NULL,
                counter BIGINT DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
    } catch (err) {
        console.error('Could not create passkey_credentials table:', err);
    }
}

// Start server
app.listen(port, () => {
    console.log(`rossoa Tracker running on port ${port}`);
    initAdmin();
    initPasskeyTable();
});

module.exports = app;