require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'rossoa_tracker',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
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
        // Get counts
        const [workersCount, constructionsCount, activeWorkers] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM workers'),
            pool.query('SELECT COUNT(*) FROM constructions'),
            pool.query("SELECT COUNT(*) FROM workers WHERE state = 'Zamestnan'")
        ]);

        // Get recent constructions
        const recentConstructions = await pool.query(`
            SELECT c.*,
                COALESCE((SELECT SUM(price) FROM materials_services WHERE construction_id = c.id), 0) +
                COALESCE((SELECT SUM(price) FROM works WHERE construction_id = c.id), 0) as total_expenses
            FROM constructions c
            ORDER BY c.created_at DESC
            LIMIT 5
        `);

        res.render('dashboard', {
            workersCount: workersCount.rows[0].count,
            constructionsCount: constructionsCount.rows[0].count,
            activeWorkers: activeWorkers.rows[0].count,
            recentConstructions: recentConstructions.rows
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.render('dashboard', {
            workersCount: 0,
            constructionsCount: 0,
            activeWorkers: 0,
            recentConstructions: []
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
    const { name, customer, beginning_date, end_date, price } = req.body;
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
        res.redirect('/constructions');
    } catch (err) {
        console.error('Constructions POST error:', err);
        res.redirect('/constructions');
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
            SELECT ms.*, c.name as construction_name
            FROM materials_services ms
            LEFT JOIN constructions c ON ms.construction_id = c.id
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
    const { construction_id, date, category, type, type_custom, price } = req.body;
    const finalType = req.body.is_custom_type === 'true' ? type_custom : type;
    try {
        // Handle custom types - check for archived match first or create new
        if (req.body.is_custom_type === 'true' && finalType) {
            if (category === 'Material') {
                const existing = await pool.query('SELECT id FROM material_types WHERE LOWER(name) = LOWER($1)', [finalType]);
                if (existing.rows.length > 0) {
                    await pool.query('UPDATE material_types SET archived = FALSE WHERE id = $1', [existing.rows[0].id]);
                } else {
                    await pool.query('INSERT INTO material_types (name) VALUES ($1)', [finalType]);
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
                `UPDATE materials_services SET construction_id = $1, date = $2, category = $3, type = $4, price = $5 WHERE id = $6`,
                [construction_id, date, category, finalType, price, req.body.id]
            );
        } else {
            await pool.query(
                'INSERT INTO materials_services (construction_id, date, category, type, price) VALUES ($1, $2, $3, $4, $5)',
                [construction_id, date, category, finalType, price]
            );
        }
        const redirectUrl = construction_id ? `/materials?construction_id=${construction_id}` : '/materials';
        res.redirect(redirectUrl);
    } catch (err) {
        console.error('Materials POST error:', err);
        res.redirect('/materials');
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

app.get('/settings', requireAuth, async (_req, res) => {
    const [materialTypes, serviceTypes] = await Promise.all([
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
        `)
    ]);
    res.render('settings', {
        materialTypes: materialTypes.rows,
        serviceTypes: serviceTypes.rows
    });
});

// ============ API ROUTES ============

app.get('/api/search-types', requireAuth, async (req, res) => {
    const { q, category } = req.query;
    if (!q || q.length < 2) return res.json([]);

    try {
        if (category === 'Material') {
            const result = await pool.query(
                'SELECT id, name FROM material_types WHERE archived = TRUE AND LOWER(name) LIKE LOWER($1) ORDER BY name',
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
    const { new_type, delete_type, restore_type } = req.body;
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
                await pool.query('INSERT INTO material_types (name) VALUES ($1)', [new_type]);
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
    const { construction_id, date, type, worker_id, price } = req.body;
    try {
        // Get worker and construction names
        const workerResult = await pool.query('SELECT name FROM workers WHERE id = $1', [worker_id]);
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
        const redirectUrl = construction_id ? `/works?construction_id=${construction_id}` : '/works';
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

// Start server
app.listen(port, () => {
    console.log(`rossoa Tracker running on port ${port}`);
    initAdmin();
});

module.exports = app;