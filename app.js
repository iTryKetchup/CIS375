const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));

function getFollowUpStatus(followUpDateValue) {
    if (!followUpDateValue) {
        return { label: 'N/A', isDue: false };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const followUpDate = new Date(followUpDateValue + 'T00:00:00');
    const daysUntil = Math.ceil((followUpDate - today) / (1000 * 60 * 60 * 24));

    if (daysUntil < 0) {
        return { label: 'Past due', isDue: true, daysUntil };
    }

    if (daysUntil === 0) {
        return { label: 'Today', isDue: true, daysUntil };
    }

    return { label: 'Coming up', isDue: false, daysUntil };
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Connect to database
const db = new sqlite3.Database('./db/jobs.db', (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
    } else {
        console.log('Connected to SQLite database.');

        db.run(`CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_name TEXT,
            job_title TEXT,
            application_source TEXT,
            application_date TEXT,
            status TEXT DEFAULT 'Applied',
            follow_up_date TEXT,
            job_url TEXT,
            resume_version TEXT,
            cover_letter_version TEXT,
            notes TEXT,
            extended_notes TEXT
        )`, (err) => {
            if (err) {
                console.error('Error creating table:', err.message);
            } else {
                console.log('Jobs table is ready and persistent.');

                const requiredColumns = [
                    ['company_name', 'TEXT'],
                    ['job_title', 'TEXT'],
                    ['application_source', 'TEXT'],
                    ['application_date', 'TEXT'],
                    ['job_url', 'TEXT'],
                    ['resume_version', 'TEXT'],
                    ['cover_letter_version', 'TEXT'],
                    ['notes', 'TEXT'],
                    ['extended_notes', 'TEXT']
                ];

                db.all('PRAGMA table_info(jobs)', (err, columns) => {
                    if (err) {
                        return console.error('Error checking table columns:', err.message);
                    }

                    const existingColumns = columns.map(column => column.name);

                    db.serialize(() => {
                        requiredColumns.forEach(([columnName, columnType]) => {
                            if (!existingColumns.includes(columnName)) {
                                db.run(`ALTER TABLE jobs ADD COLUMN ${columnName} ${columnType}`, (err) => {
                                    if (err && !err.message.includes('duplicate column name')) {
                                        console.error(`Error adding ${columnName}:`, err.message);
                                    }
                                });
                            }
                        });

                        if (existingColumns.includes('company')) {
                            db.run('UPDATE jobs SET company_name = company WHERE company_name IS NULL', (err) => {
                                if (err) {
                                    console.error('Error updating company names:', err.message);
                                }
                            });
                        }

                        if (existingColumns.includes('position')) {
                            db.run('UPDATE jobs SET job_title = position WHERE job_title IS NULL', (err) => {
                                if (err) {
                                    console.error('Error updating job titles:', err.message);
                                }
                            });
                        }

                        if (existingColumns.includes('source')) {
                            db.run('UPDATE jobs SET application_source = source WHERE application_source IS NULL', (err) => {
                                if (err) {
                                    console.error('Error updating application sources:', err.message);
                                }
                            });
                        }

                        if (existingColumns.includes('date_applied')) {
                            db.run('UPDATE jobs SET application_date = date_applied WHERE application_date IS NULL', (err) => {
                                if (err) {
                                    console.error('Error updating application dates:', err.message);
                                }
                            });
                        }
                    });
                });

                db.run(`CREATE TABLE IF NOT EXISTS job_references (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id INTEGER NOT NULL,
                    reference_name TEXT,
                    reference_email TEXT,
                    reference_phone TEXT,
                    reference_note TEXT,
                    FOREIGN KEY(job_id) REFERENCES jobs(id)
                )`, (err) => {
                    if (err) {
                        console.error('Error creating references table:', err.message);
                    }
                });
            }
        });
    }
});

// Homepage redirect
app.get('/', (req, res) => {
    res.redirect('/jobs');
});

// Help page
app.get('/help', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'help.html'));
});

// Add job page
app.get('/add-job', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'add-job.html'));
});

// Save new job
app.post('/save-job', (req, res) => {
    const {
        companyName,
        jobTitle,
        applicationSource,
        applicationDate,
        status,
        followUpDate,
        jobUrl,
        resumeVersion,
        coverLetterVersion,
        notes
    } = req.body;

    const jobData = {
        company: companyName,
        position: jobTitle,
        source: applicationSource,
        date_applied: applicationDate,
        company_name: companyName,
        job_title: jobTitle,
        application_source: applicationSource,
        application_date: applicationDate,
        status,
        follow_up_date: followUpDate,
        job_url: jobUrl,
        resume_version: resumeVersion,
        cover_letter_version: coverLetterVersion,
        notes
    };

    db.all('PRAGMA table_info(jobs)', (err, columns) => {
        if (err) {
            console.error(err.message);
            res.status(500).send('Error saving to database');
            return;
        }

        const existingColumns = columns.map(column => column.name);
        const insertColumns = Object.keys(jobData).filter(columnName => existingColumns.includes(columnName));
        const placeholders = insertColumns.map(() => '?').join(', ');
        const sql = `INSERT INTO jobs (${insertColumns.join(', ')}) VALUES (${placeholders})`;
        const params = insertColumns.map(columnName => jobData[columnName]);

        db.run(sql, params, (err) => {
            if (err) {
                console.error(err.message);
                res.status(500).send('Error saving to database');
            } else {
                console.log('New job entry saved!');
                res.redirect('/jobs');
            }
        });
    });
});

// View jobs with search/filter
app.get('/jobs', (req, res) => {
    const search = req.query.search || '';
    const statusFilter = req.query.status || '';

    let sql = 'SELECT * FROM jobs WHERE 1=1';
    const params = [];

    if (search.trim() !== '') {
        sql += ' AND (LOWER(company_name) LIKE ? OR LOWER(job_title) LIKE ?)';
        params.push(`%${search.toLowerCase()}%`);
        params.push(`%${search.toLowerCase()}%`);
    }

    if (statusFilter.trim() !== '') {
        sql += ' AND status = ?';
        params.push(statusFilter);
    }

    sql += ' ORDER BY application_date DESC';

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Error reading database');
        }

        rows.sort((a, b) => {
            const aFollowUpStatus = getFollowUpStatus(a.follow_up_date);
            const bFollowUpStatus = getFollowUpStatus(b.follow_up_date);
            const aIsPastDue = aFollowUpStatus.daysUntil < 0;
            const bIsPastDue = bFollowUpStatus.daysUntil < 0;

            if (aIsPastDue !== bIsPastDue) {
                return aIsPastDue ? -1 : 1;
            }

            return String(a.company_name || '').localeCompare(String(b.company_name || ''), undefined, {
                sensitivity: 'base'
            });
        });

        db.all('SELECT status, COUNT(*) AS count FROM jobs GROUP BY status', [], (countErr, countRows) => {
            if (countErr) {
                console.error(countErr.message);
                return res.status(500).send('Error reading dashboard counts');
            }

            // Week 8 Dashboard: Applications by Status
            const statusCounts = {
                Applied: 0,
                Interview: 0,
                'Follow-Up': 0,
                Offer: 0,
                Rejected: 0
            };

            countRows.forEach(statusRow => {
                if (statusCounts[statusRow.status] !== undefined) {
                    statusCounts[statusRow.status] = statusRow.count;
                }
            });

            const totalApplications = countRows.reduce((total, statusRow) => total + statusRow.count, 0);

            db.all(
                "SELECT company_name, job_title, follow_up_date FROM jobs WHERE follow_up_date IS NOT NULL AND follow_up_date != ''",
                [],
                (followUpErr, followUpRows) => {
                    if (followUpErr) {
                        console.error(followUpErr.message);
                        return res.status(500).send('Error reading follow-up summaries');
                    }

                    const followUpSummaries = followUpRows.map(job => {
                        const followUpStatus = getFollowUpStatus(job.follow_up_date);

                        return {
                            ...job,
                            daysUntil: followUpStatus.daysUntil
                        };
                    });

                    const pastDueFollowUps = followUpSummaries
                        .filter(job => job.daysUntil < 0)
                        .sort((a, b) => a.daysUntil - b.daysUntil);

                    const upcomingFollowUps = followUpSummaries
                        .filter(job => job.daysUntil > 0)
                        .sort((a, b) => a.daysUntil - b.daysUntil);

                    const pastDueHoverHtml = pastDueFollowUps.length === 0
                        ? '<p>No past-due follow-ups.</p>'
                        : `<ul>${pastDueFollowUps.map(job => `
                            <li>
                                <strong>${escapeHtml(job.company_name || 'N/A')}</strong> - ${escapeHtml(job.job_title || 'N/A')}
                                <br>${escapeHtml(job.follow_up_date)} (${Math.abs(job.daysUntil)} day(s) past due)
                            </li>
                        `).join('')}</ul>`;

                    const upcomingHoverHtml = upcomingFollowUps.length === 0
                        ? '<p>No upcoming follow-ups.</p>'
                        : `<ul>${upcomingFollowUps.map(job => `
                            <li>
                                <strong>${escapeHtml(job.company_name || 'N/A')}</strong> - ${escapeHtml(job.job_title || 'N/A')}
                                <br>${escapeHtml(job.follow_up_date)} (${job.daysUntil} day(s) away)
                            </li>
                        `).join('')}</ul>`;

        let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Career Tracker - Dashboard</title>
    <style>
        .past-due-label {
            color: red;
        }

        .nav-divider,
        .content-divider {
            border: 0;
            border-top: 1px solid #999;
        }

        .dashboard-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
            padding: 8px 0;
        }

        .dashboard-title {
            margin: 0;
            font-size: 1.6rem;
        }

        .dashboard-nav {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            justify-content: flex-end;
        }

        .dashboard-nav a {
            font-weight: bold;
            text-decoration: none;
        }

        .job-card-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 10px;
            margin-top: 12px;
            align-items: start;
        }

        .job-card {
            border: 1px solid #999;
            padding: 9px;
            background-color: #fff;
            align-self: start;
        }

        .job-card summary {
            cursor: pointer;
            display: flex;
            align-items: flex-start;
            gap: 8px;
            list-style: none;
        }

        .job-card summary::-webkit-details-marker {
            display: none;
        }

        .job-card summary::marker {
            content: "";
        }

        .job-card summary::before {
            content: "▶";
            flex: 0 0 auto;
            line-height: 1.2;
            margin-top: 1px;
        }

        .job-card[open] summary::before {
            content: "▼";
        }

        .job-card-summary {
            display: flex;
            flex-direction: column;
            gap: 3px;
            min-width: 0;
        }

        .job-card-body {
            margin-top: 9px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .status-badge,
        .past-due-badge {
            display: inline-block;
        }

        .past-due-badge {
            color: red;
            font-weight: bold;
        }

        .job-card-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
        }

        .job-card-actions a {
            font-weight: bold;
            text-decoration: none;
        }

        .job-card-controls form {
            margin: 0 0 10px 0;
        }

        .dashboard-quick-filter {
            position: sticky;
            top: 0;
            z-index: 100;
            background: white;
            border-top: 1px solid #999;
            border-bottom: 1px solid #999;
            padding: 10px 0;
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            align-items: center;
        }

        .dashboard-quick-filter a {
            font-weight: bold;
            text-decoration: none;
        }

        .quick-filter-links,
        .sticky-tools,
        .follow-up-hover-group {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            align-items: center;
        }

        .sticky-tools {
            margin-left: auto;
        }

        .results-count {
            font-weight: bold;
        }

        .search-summary {
            position: relative;
        }

        .search-toggle {
            border: 1px solid #7aa7d9;
            background: #eaf3ff;
            color: #003b73;
            padding: 4px 8px;
            cursor: pointer;
            font-weight: bold;
            list-style: none;
            box-shadow: 0 1px 3px rgba(0, 59, 115, 0.15);
        }

        .search-toggle::-webkit-details-marker {
            display: none;
        }

        .search-toggle::marker {
            content: "";
        }

        .sticky-search-form {
            position: absolute;
            bottom: 100%;
            right: 0;
            margin-bottom: 6px;
            width: 280px;
            background: white;
            border: 1px solid #999;
            padding: 10px;
            z-index: 300;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            display: none;
            flex-wrap: wrap;
            gap: 6px;
            align-items: center;
        }

        .search-summary[open] .sticky-search-form {
            display: flex;
        }

        .sticky-search-form input {
            flex: 1 1 160px;
            min-width: 0;
            padding: 5px;
        }

        .sticky-search-form button {
            padding: 5px 8px;
        }

        .follow-up-summary {
            position: relative;
            display: inline-block;
        }

        .follow-up-summary-trigger {
            border: 1px solid #999;
            background: #f9f9f9;
            padding: 4px 8px;
            cursor: default;
            font-weight: bold;
        }

        .follow-up-tooltip {
            display: none;
            position: absolute;
            top: 100%;
            right: 0;
            width: 330px;
            max-height: 240px;
            overflow-y: auto;
            background: white;
            border: 1px solid #999;
            padding: 10px;
            z-index: 200;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            font-weight: normal;
        }

        .follow-up-tooltip ul {
            margin: 0;
            padding-left: 18px;
        }

        .follow-up-tooltip li {
            margin-bottom: 8px;
        }

        .follow-up-summary:hover .follow-up-tooltip,
        .follow-up-summary:focus-within .follow-up-tooltip {
            display: block;
        }
    </style>
</head>
<body>
    <header class="dashboard-header">
        <h1 class="dashboard-title">Career Tracker</h1>
        <nav class="dashboard-nav" aria-label="Main navigation">
            <a href="/jobs">Dashboard</a>
            <span>|</span>
            <a href="/add-job">Add New Job</a>
            <span>|</span>
            <a href="/help">Help</a>
            <span>|</span>
            <a href="/jobs/star-help">STAR Interview Cheat Sheet</a>
        </nav>
    </header>

    <hr class="nav-divider">

    <div class="dashboard-quick-filter">
        <div class="quick-filter-links">
            <a href="/jobs">All: ${totalApplications}</a>
            <a href="/jobs?status=Applied">Applied: ${statusCounts.Applied}</a>
            <a href="/jobs?status=Interview">Interview: ${statusCounts.Interview}</a>
            <a href="/jobs?status=Follow-Up">Follow-Up: ${statusCounts['Follow-Up']}</a>
            <a href="/jobs?status=Offer">Offer: ${statusCounts.Offer}</a>
            <a href="/jobs?status=Rejected">Rejected: ${statusCounts.Rejected}</a>
            <span>|</span>
            <span class="results-count">Results: ${rows.length}</span>
        </div>

        <div class="sticky-tools">
            <details class="search-summary">
                <summary class="search-toggle">Search</summary>
                <form action="/jobs" method="GET" class="sticky-search-form">
                    <input
                        type="text"
                        name="search"
                        placeholder="Company or job title"
                        value="${escapeHtml(search)}"
                    >
                    <button type="submit">Search</button>
                    <a href="/jobs">Clear Filters</a>
                </form>
            </details>

            <div class="follow-up-summary" tabindex="0">
                <span class="follow-up-summary-trigger">Past Due</span>
                <div class="follow-up-tooltip">${pastDueHoverHtml}</div>
            </div>
            <div class="follow-up-summary" tabindex="0">
                <span class="follow-up-summary-trigger">Upcoming</span>
                <div class="follow-up-tooltip">${upcomingHoverHtml}</div>
            </div>
        </div>
    </div>

    <hr class="content-divider">
        `;

        if (rows.length === 0) {
            html += `
                <p style="font-weight: bold; color: #b00020;">
                    No matching applications found. Try clearing the filters or searching another company/job title.
                </p>
            `;
        } else {
            html += `
    <div class="job-card-grid">
            `;

            rows.forEach(job => {
                let rowStyle = '';
                let statusIcon = '';
                const followUpStatus = getFollowUpStatus(job.follow_up_date);
                const companyName = escapeHtml(job.company_name || 'Unknown Company');
                const jobTitle = escapeHtml(job.job_title || 'Unknown Role');
                const statusText = escapeHtml(job.status || 'No Status');
                const sourceText = job.application_source ? escapeHtml(job.application_source) : '';
                const appliedDateText = job.application_date ? escapeHtml(job.application_date) : '';
                const metadataParts = [];
                const followUpLine = job.follow_up_date
                    ? `<div><strong>Follow-up:</strong> ${followUpStatus.daysUntil < 0 ? '<span class="past-due-label">⚠ Past due</span> ' : ''}${escapeHtml(job.follow_up_date)}</div>`
                    : '';

                if (sourceText) {
                    metadataParts.push(sourceText);
                }

                if (appliedDateText) {
                    metadataParts.push(`Applied ${appliedDateText}`);
                }

                const metadataLine = metadataParts.length > 0
                    ? `<div>${metadataParts.join(' • ')}</div>`
                    : '';

                if (job.status === 'Follow-Up') {
                    rowStyle = 'background-color: #fff3cd; font-weight: bold;';
                } else if (job.status === 'Interview') {
                    rowStyle = 'background-color: #d1ecf1;';
                    statusIcon = '⭐ ';
                } else if (job.status === 'Rejected') {
                    rowStyle = 'background-color: #e2e3e5; color: #666;';
                    statusIcon = '✖ ';
                } else if (job.status === 'Offer') {
                    rowStyle = 'background-color: #d4edda; font-weight: bold;';
                    statusIcon = '✅ ';
                }

                if (followUpStatus.isDue) {
                    rowStyle = 'background-color: #fff3cd; font-weight: bold;';
                }

                html += `
            <details class="job-card" style="${rowStyle}">
                <summary>
                    <span class="job-card-summary">
                        <strong>${companyName}</strong>
                        <span>${jobTitle}</span>
                        <span class="status-badge">${statusIcon}${statusText}</span>
                        ${followUpStatus.daysUntil < 0 ? '<span class="past-due-badge">⚠ Past due</span>' : ''}
                    </span>
                </summary>

                <div class="job-card-body">
                    ${metadataLine}
                    ${followUpLine}

                    <div class="job-card-actions">
                    <a href="/jobs/${job.id}" style="text-decoration:none; font-weight:bold;">
                       View Details
                    </a>
                    </div>
                </div>
            </details>
                `;
            });

            html += `
    </div>
            `;
        }

        html += `
    <script>
        const searchDetails = document.querySelector('.search-summary');
        const searchInput = document.querySelector('.sticky-search-form input[name="search"]');

        if (searchDetails && searchInput) {
            searchDetails.addEventListener('toggle', () => {
                if (searchDetails.open) {
                    setTimeout(() => searchInput.focus(), 0);
                }
            });
        }
    </script>
</body>
</html>
        `;

        res.send(html);
                });
        });
    });
});

// STAR interview help page
app.get('/jobs/star-help', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>STAR Interview Cheat Sheet - Career Tracker</title>
    <style>
        body {
            line-height: 1.5;
        }

        .page-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
            padding: 8px 0;
        }

        .page-title {
            margin: 0;
            font-size: 1.6rem;
        }

        .page-nav {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            justify-content: flex-end;
        }

        .page-nav a {
            font-weight: bold;
            text-decoration: none;
        }

        .header-divider {
            border: 0;
            border-top: 1px solid #999;
            margin-bottom: 16px;
        }

        .star-callout {
            border: 1px solid #999;
            padding: 18px;
            margin-bottom: 20px;
            background-color: #f9f9f9;
        }

        .star-callout h2 {
            margin-top: 0;
        }

        .star-tile {
            border: 1px solid #999;
            padding: 12px;
            margin-bottom: 12px;
            background-color: #fff;
        }

        .star-tile summary {
            cursor: pointer;
            font-weight: bold;
            font-size: 1.05em;
        }
    </style>
</head>
<body>
    <header class="page-header">
        <h1 class="page-title">STAR Interview Cheat Sheet</h1>
        <nav class="page-nav" aria-label="Main navigation">
            <a href="/jobs">Dashboard</a>
            <span>|</span>
            <a href="/add-job">Add New Job</a>
            <span>|</span>
            <a href="/help">Help</a>
            <span>|</span>
            <a href="/jobs/star-help">STAR Interview Cheat Sheet</a>
        </nav>
    </header>

    <hr class="header-divider">

    <div class="star-callout">
        <h2>STAR = Situation &rarr; Task &rarr; Action &rarr; Result</h2>
        <p>This framework structures your behavioral answers to keep them high-impact and prevent rambling.</p>

        <ul>
            <li><strong>Situation:</strong> Set the context.</li>
            <li><strong>Task:</strong> Explain your responsibility or goal.</li>
            <li><strong>Action:</strong> Describe the specific steps you took.</li>
            <li><strong>Result:</strong> Share the outcome, impact, or lesson learned.</li>
        </ul>
    </div>

    <details class="star-tile">
        <summary>🧍‍♂️ In-Person Interviews</summary>
        <ul>
            <li>Keep STAR answers around 60-90 seconds unless the interviewer asks for more detail.</li>
            <li>Use steady pacing and pause briefly between STAR sections.</li>
            <li>Maintain natural eye contact without staring.</li>
            <li>Use body language that shows engagement: sit upright, nod when appropriate, and avoid fidgeting.</li>
        </ul>

        <p><strong>Common prompts:</strong></p>
        <ul>
            <li>Tell me about a time you handled conflict.</li>
            <li>Tell me about a time you solved a problem under pressure.</li>
            <li>Tell me about a time you worked with a difficult stakeholder.</li>
        </ul>
    </details>

    <details class="star-tile">
        <summary>📞 Phone Interviews</summary>
        <ul>
            <li>Prioritize voice tone, clarity, and pacing because the interviewer cannot see body language.</li>
            <li>Smile slightly while speaking to make your tone sound more engaged.</li>
            <li>Use verbal transitions like: "The situation was...", "My responsibility was...", "The action I took was...", and "The result was..."</li>
            <li>Keep notes nearby, but do not sound like you are reading word-for-word.</li>
        </ul>

        <p><strong>Common prompts:</strong></p>
        <ul>
            <li>Walk me through your background.</li>
            <li>Why are you interested in this role?</li>
            <li>Tell me about a time you had to learn something quickly.</li>
        </ul>
    </details>

    <details class="star-tile">
        <summary>💻 Virtual / Video Interviews</summary>
        <ul>
            <li>Check camera framing before the interview.</li>
            <li>Prioritize audio quality over perfect video.</li>
            <li>Look near the camera when giving key parts of an answer.</li>
            <li>Keep notes nearby but avoid looking away too often.</li>
            <li>Test lighting, microphone, and internet before the interview.</li>
        </ul>

        <p><strong>Common prompts:</strong></p>
        <ul>
            <li>Tell me about a project you are proud of.</li>
            <li>Tell me about a time you communicated across a team.</li>
            <li>Tell me about a time you adapted to change.</li>
        </ul>
    </details>

    <details class="star-tile">
        <summary>🗃️ Building Your Story Bank</summary>
        <p>Prepare a small bank of reusable STAR stories instead of trying to memorize full paragraphs.</p>

        <ul>
            <li>Conflict or difficult teamwork</li>
            <li>Process improvement</li>
            <li>Learning something quickly</li>
            <li>Mistake and recovery</li>
            <li>Working under pressure</li>
            <li>Customer, client, or stakeholder issue</li>
            <li>Leadership or ownership</li>
            <li>Technical or systems problem-solving</li>
        </ul>

        <p><strong>Pro tip:</strong> Use bullet points instead of full paragraphs. Memorize the structure, not a script.</p>
    </details>

    <details class="star-tile">
        <summary>📋 Practice Drills & Checklists</summary>

        <h3>60-Second Drill</h3>
        <p>Pick one STAR story and explain it in under 60 seconds.</p>

        <h3>Result-First Drill</h3>
        <p>Say the result first, then explain the situation and actions that led to it.</p>

        <h3>Day-of Interview Checklist</h3>
        <ul>
            <li>Review the job description.</li>
            <li>Pick 3 STAR stories that match the role.</li>
            <li>Check resume version and job posting notes in Career Tracker.</li>
            <li>Prepare one question for the interviewer.</li>
            <li>Test camera, microphone, and internet if virtual.</li>
            <li>Keep water nearby.</li>
            <li>Pause before answering difficult questions.</li>
        </ul>
    </details>
</body>
</html>
    `);
});

// Editable job details page
app.get('/jobs/:id', (req, res) => {
    const jobId = req.params.id;

    db.get('SELECT * FROM jobs WHERE id = ?', [jobId], (err, job) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Error reading job details');
        }

        if (!job) {
            return res.status(404).send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Job Not Found - Career Tracker</title>
</head>
<body>
    <nav>
        <a href="/jobs">Dashboard</a> |
        <a href="/add-job">Add New Job</a> |
        <a href="/help">Help</a> |
        <a href="/jobs/star-help">STAR Interview Cheat Sheet</a>
    </nav>

    <hr>

    <h1>Job not found</h1>
    <p>The requested job application could not be found.</p>
    <p><a href="/jobs">Back to Dashboard</a></p>
</body>
</html>
            `);
        }

        const companyName = escapeHtml(job.company_name || job.company || '');
        const jobTitle = escapeHtml(job.job_title || job.position || '');
        const applicationSource = escapeHtml(job.application_source || job.source || '');
        const applicationDate = escapeHtml(job.application_date || job.date_applied || '');
        const status = escapeHtml(job.status || 'Applied');
        const followUpDate = escapeHtml(job.follow_up_date || '');
        const jobUrl = escapeHtml(job.job_url || '');
        const resumeVersion = escapeHtml(job.resume_version || '');
        const coverLetterVersion = escapeHtml(job.cover_letter_version || '');
        const notes = escapeHtml(job.notes || '');
        const extendedNotes = escapeHtml(job.extended_notes || '');

        db.all('SELECT * FROM job_references WHERE job_id = ? ORDER BY id', [jobId], (err, references) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Error reading job references');
            }

            const referencesHtml = references.length === 0
                ? '<p>No references added for this application yet.</p>'
                : `
                    ${references.map(reference => `
                        <div style="border:1px solid #ccc; padding:10px; margin-bottom:12px; background-color:#fff;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
                                <strong>${escapeHtml(reference.reference_name || 'Unnamed Reference')}</strong>

                                <div style="display:flex; gap:8px; align-items:flex-start;">
                                    <details>
                                        <summary style="cursor:pointer; border:1px solid #999; padding:2px 6px; background-color:#f2f2f2;">Edit Reference</summary>
                                    <form action="/jobs/${job.id}/references/${reference.id}/update" method="POST" style="margin-top:8px;">
                                        <p>
                                            <label for="referenceName${reference.id}">Reference Name:</label><br>
                                            <input type="text" id="referenceName${reference.id}" name="referenceName" value="${escapeHtml(reference.reference_name || '')}">
                                        </p>

                                        <p>
                                            <label for="referenceEmail${reference.id}">Reference Email:</label><br>
                                            <input type="email" id="referenceEmail${reference.id}" name="referenceEmail" value="${escapeHtml(reference.reference_email || '')}">
                                        </p>

                                        <p>
                                            <label for="referencePhone${reference.id}">Reference Phone Number:</label><br>
                                            <input type="text" id="referencePhone${reference.id}" name="referencePhone" value="${escapeHtml(reference.reference_phone || '')}">
                                        </p>

                                        <p>
                                            <label for="referenceNote${reference.id}">Reference Note:</label><br>
                                            <textarea id="referenceNote${reference.id}" name="referenceNote" rows="4" cols="60">${escapeHtml(reference.reference_note || '')}</textarea>
                                        </p>

                                        <button type="submit">Update Reference</button>
                                    </form>
                                    </details>

                                    <form action="/jobs/${job.id}/references/${reference.id}/delete" method="POST" style="margin:0;">
                                        <button type="submit" onclick="return confirm('Delete this reference?')">Delete Reference</button>
                                    </form>
                                </div>
                            </div>

                            <div style="margin-top:8px;">
                                ${reference.reference_email ? `<div>Email: ${escapeHtml(reference.reference_email)}</div>` : ''}
                                ${reference.reference_phone ? `<div>Phone: ${escapeHtml(reference.reference_phone)}</div>` : ''}
                                ${reference.reference_note ? `<div>Note: ${escapeHtml(reference.reference_note)}</div>` : ''}
                            </div>
                        </div>
                    `).join('')}
                `;

        res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${companyName || 'Job'} - Job Details</title>
    <style>
        .page-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
            padding: 8px 0;
        }

        .page-title {
            margin: 0;
            font-size: 1.6rem;
        }

        .page-nav {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            justify-content: flex-end;
        }

        .page-nav a {
            font-weight: bold;
            text-decoration: none;
        }

        .header-divider,
        .content-divider {
            border: 0;
            border-top: 1px solid #999;
        }

        .back-link {
            margin: 12px 0;
        }

        .details-action-row {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            align-items: center;
            margin: 12px 0;
        }

        .details-container {
            max-width: 1200px;
        }

        .job-details-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 16px 28px;
            align-items: start;
            border: 1px solid #999;
            padding: 15px;
            margin-bottom: 20px;
            background-color: #f9f9f9;
        }

        .form-column {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .form-field {
            margin: 0;
        }

        label {
            font-weight: bold;
        }

        input,
        select,
        textarea {
            box-sizing: border-box;
            width: 100%;
            max-width: 100%;
            padding: 6px;
        }

        textarea {
            resize: vertical;
        }

        #notes {
            min-height: 140px;
        }

        #extendedNotes {
            min-height: 240px;
        }

        .form-actions {
            margin: 16px 0 24px 0;
        }

        button[type="submit"] {
            padding: 8px 12px;
            font-weight: bold;
            cursor: pointer;
        }

        .references-panel {
            border: 1px solid #999;
            padding: 15px;
            margin-bottom: 20px;
            background-color: #f9f9f9;
        }

        .delete-job-section {
            border: 1px solid #b00020;
            padding: 15px;
            margin-bottom: 20px;
            background-color: #fff5f5;
        }

        .delete-job-section input {
            max-width: 240px;
        }

        .delete-job-section button {
            color: #b00020;
        }
    </style>
</head>
<body>
    <header class="page-header">
        <h1 class="page-title">Job Details</h1>
        <nav class="page-nav" aria-label="Main navigation">
            <a href="/jobs">Dashboard</a>
            <span>|</span>
            <a href="/add-job">Add New Job</a>
            <span>|</span>
            <a href="/help">Help</a>
            <span>|</span>
            <a href="/jobs/star-help">STAR Interview Cheat Sheet</a>
        </nav>
    </header>

    <hr class="header-divider">

    <main class="details-container">
    <div class="details-action-row">
        <a href="/jobs">Back to Dashboard</a>
        <button type="submit" form="jobDetailsForm">Update Job Details</button>
    </div>

    <hr class="content-divider">

    <form id="jobDetailsForm" action="/jobs/${job.id}/update" method="POST">
        <div class="job-details-grid">
            <div class="form-column">
            <p class="form-field">
                <label for="companyName">Company Name:</label><br>
                <input type="text" id="companyName" name="companyName" value="${companyName}" required>
            </p>

            <p class="form-field">
                <label for="jobTitle">Job Title:</label><br>
                <input type="text" id="jobTitle" name="jobTitle" value="${jobTitle}" required>
            </p>

            <p class="form-field">
                <label for="applicationSource">Application Source:</label><br>
                <input type="text" id="applicationSource" name="applicationSource" value="${applicationSource}">
            </p>

            <p class="form-field">
                <label for="applicationDate">Application Date:</label><br>
                <input type="date" id="applicationDate" name="applicationDate" value="${applicationDate}">
            </p>

            <p class="form-field">
                <label for="status">Current Status:</label><br>
                <select id="status" name="status">
                    <option value="Applied" ${status === 'Applied' ? 'selected' : ''}>Applied</option>
                    <option value="Interview" ${status === 'Interview' ? 'selected' : ''}>Interview</option>
                    <option value="Follow-Up" ${status === 'Follow-Up' ? 'selected' : ''}>Follow-Up</option>
                    <option value="Offer" ${status === 'Offer' ? 'selected' : ''}>Offer</option>
                    <option value="Rejected" ${status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                </select>
            </p>

            <p class="form-field">
                <label for="followUpDate">Follow-up Date:</label><br>
                <input type="date" id="followUpDate" name="followUpDate" value="${followUpDate}">
            </p>

            <p class="form-field">
                <label for="jobUrl">Job Posting URL:</label><br>
                <input type="url" id="jobUrl" name="jobUrl" value="${jobUrl}">
                ${jobUrl ? `<br><a href="${jobUrl}" target="_blank">View Posting</a>` : ''}
            </p>
            </div>

            <div class="form-column">
            <p class="form-field">
                <label for="resumeVersion">Resume Version Used:</label><br>
                <input type="text" id="resumeVersion" name="resumeVersion" value="${resumeVersion}">
            </p>

            <p class="form-field">
                <label for="coverLetterVersion">Cover Letter Version Used:</label><br>
                <input type="text" id="coverLetterVersion" name="coverLetterVersion" value="${coverLetterVersion}">
            </p>
        

        <h2 title="Short notes from the application stage, such as recruiter names, quick reminders, follow-up context, or application-specific details.">Application Stage Notes ⓘ</h2>
            <div class="form-field">
            <textarea id="notes" name="notes" rows="6" cols="70">${notes}</textarea>
            </div>

        <h2 title="Long-form notes for interview prep, STAR examples, company research, salary notes, detailed follow-up planning, and deeper job-specific information.">Extended Notes ⓘ</h2>
            <div class="form-field">
            <textarea id="extendedNotes" name="extendedNotes" rows="12" cols="90">${extendedNotes}</textarea>
            </div>
            </div>
        </div>

    </form>

    <h2>References Used</h2>
    <div class="references-panel">
        ${referencesHtml}

        <details>
            <summary>+ Add Reference</summary>
            <form action="/jobs/${job.id}/references" method="POST" style="margin-top:15px;">
                <p>
                    <label for="referenceName">Reference Name:</label><br>
                    <input type="text" id="referenceName" name="referenceName">
                </p>

                <p>
                    <label for="referenceEmail">Reference Email:</label><br>
                    <input type="email" id="referenceEmail" name="referenceEmail">
                </p>

                <p>
                    <label for="referencePhone">Reference Phone Number:</label><br>
                    <input type="text" id="referencePhone" name="referencePhone">
                </p>

                <p>
                    <label for="referenceNote">Reference Note:</label><br>
                    <textarea id="referenceNote" name="referenceNote" rows="4" cols="60"></textarea>
                </p>

                <button type="submit">Save Reference</button>
            </form>
        </details>
    </div>

    <section class="delete-job-section">
        <h2>Delete Job</h2>
        <p>Deleting this job removes the application and any references linked to it.</p>
        <form action="/jobs/${job.id}/delete" method="POST">
            <p>
                <label for="confirmDelete">Type DELETE to confirm</label><br>
                <input type="text" id="confirmDelete" name="confirmDelete" autocomplete="off">
            </p>
            <button type="submit">Delete Job</button>
        </form>
    </section>

    <div class="details-action-row">
        <a href="/jobs">Back to Dashboard</a>
        <button type="submit" form="jobDetailsForm">Update Job Details</button>
    </div>
    </main>

    <script>
        const jobDetailsForm = document.getElementById('jobDetailsForm');
        let hasUnsavedChanges = false;

        if (jobDetailsForm) {
            jobDetailsForm.addEventListener('input', () => {
                hasUnsavedChanges = true;
            });

            jobDetailsForm.addEventListener('change', () => {
                hasUnsavedChanges = true;
            });

            jobDetailsForm.addEventListener('submit', () => {
                hasUnsavedChanges = false;
            });
        }

        window.addEventListener('beforeunload', (event) => {
            if (!hasUnsavedChanges) {
                return;
            }

            event.preventDefault();
            event.returnValue = '';
        });
    </script>
</body>
</html>
        `);
        });
    });
});

// Update job details
app.post('/jobs/:id/update', (req, res) => {
    const jobId = req.params.id;
    const {
        companyName,
        jobTitle,
        applicationSource,
        applicationDate,
        status,
        followUpDate,
        jobUrl,
        resumeVersion,
        coverLetterVersion,
        notes,
        extendedNotes
    } = req.body;

    const jobData = {
        company: companyName,
        position: jobTitle,
        source: applicationSource,
        date_applied: applicationDate,
        company_name: companyName,
        job_title: jobTitle,
        application_source: applicationSource,
        application_date: applicationDate,
        status,
        follow_up_date: followUpDate,
        job_url: jobUrl,
        resume_version: resumeVersion,
        cover_letter_version: coverLetterVersion,
        notes,
        extended_notes: extendedNotes
    };

    db.all('PRAGMA table_info(jobs)', (err, columns) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Error updating job details');
        }

        const existingColumns = columns.map(column => column.name);
        const updateColumns = Object.keys(jobData).filter(columnName => existingColumns.includes(columnName));
        const assignments = updateColumns.map(columnName => `${columnName} = ?`).join(', ');
        const params = updateColumns.map(columnName => jobData[columnName]);
        params.push(jobId);

        db.run(`UPDATE jobs SET ${assignments} WHERE id = ?`, params, function(err) {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Error updating job details');
            }

            if (this.changes === 0) {
                return res.status(404).send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Job Not Found - Career Tracker</title>
</head>
<body>
    <h1>Job not found</h1>
    <p>The requested job application could not be found.</p>
    <p><a href="/jobs">Back to Dashboard</a></p>
</body>
</html>
                `);
            }

            res.redirect(`/jobs/${jobId}`);
        });
    });
});

// Add job reference
app.post('/jobs/:id/references', (req, res) => {
    const jobId = req.params.id;
    const {
        referenceName,
        referenceEmail,
        referencePhone,
        referenceNote
    } = req.body;

    const sql = `
        INSERT INTO job_references
        (job_id, reference_name, reference_email, reference_phone, reference_note)
        VALUES (?, ?, ?, ?, ?)
    `;

    db.run(sql, [jobId, referenceName, referenceEmail, referencePhone, referenceNote], (err) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Error saving reference');
        }

        res.redirect(`/jobs/${jobId}`);
    });
});

// Update job reference
app.post('/jobs/:jobId/references/:referenceId/update', (req, res) => {
    const { jobId, referenceId } = req.params;
    const {
        referenceName,
        referenceEmail,
        referencePhone,
        referenceNote
    } = req.body;

    const sql = `
        UPDATE job_references
        SET reference_name = ?,
            reference_email = ?,
            reference_phone = ?,
            reference_note = ?
        WHERE id = ? AND job_id = ?
    `;

    db.run(sql, [referenceName, referenceEmail, referencePhone, referenceNote, referenceId, jobId], (err) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Error updating reference');
        }

        res.redirect(`/jobs/${jobId}`);
    });
});

// Delete job reference
app.post('/jobs/:jobId/references/:referenceId/delete', (req, res) => {
    const { jobId, referenceId } = req.params;

    db.run('DELETE FROM job_references WHERE id = ? AND job_id = ?', [referenceId, jobId], (err) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Error deleting reference');
        }

        res.redirect(`/jobs/${jobId}`);
    });
});

// Update status
app.post('/update-status/:id', (req, res) => {
    const jobId = req.params.id;
    const newStatus = req.body.status;

    const sql = 'UPDATE jobs SET status = ? WHERE id = ?';

    db.run(sql, [newStatus, jobId], (err) => {
        if (err) {
            console.error(err.message);
            res.status(500).send('Error updating status');
        } else {
            console.log(`Job ${jobId} updated to ${newStatus}`);
            res.redirect('/jobs');
        }
    });
});

// Update follow-up date
app.post('/update-followup/:id', (req, res) => {
    const jobId = req.params.id;
    const newDate = req.body.followUpDate;

    const sql = 'UPDATE jobs SET follow_up_date = ? WHERE id = ?';

    db.run(sql, [newDate, jobId], (err) => {
        if (err) {
            console.error(err.message);
            res.status(500).send('Error updating follow-up date');
        } else {
            console.log(`Follow-up for Job ${jobId} updated to ${newDate}`);
            res.redirect('/jobs');
        }
    });
});

// Delete job with typed confirmation
app.post('/jobs/:id/delete', (req, res) => {
    const jobId = req.params.id;
    const { confirmDelete } = req.body;

    if (confirmDelete !== 'DELETE') {
        return res.redirect(`/jobs/${jobId}`);
    }

    db.run('DELETE FROM job_references WHERE job_id = ?', [jobId], (err) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Error deleting job references');
        }

        db.run('DELETE FROM jobs WHERE id = ?', [jobId], (err) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Error deleting job');
            }

            console.log(`Job ID ${jobId} deleted successfully.`);
            res.redirect('/jobs');
        });
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
