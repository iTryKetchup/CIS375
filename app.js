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
            cover_letter_version TEXT
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
                    ['cover_letter_version', 'TEXT']
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
        coverLetterVersion
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
        cover_letter_version: coverLetterVersion
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
        // Week 8 Dashboard: Applications by Status
const statusCounts = {
    Applied: 0,
    Interview: 0,
    'Follow-Up': 0,
    Offer: 0,
    Rejected: 0
};

rows.forEach(job => {
    if (statusCounts[job.status] !== undefined) {
        statusCounts[job.status]++;
    }
});

// Week 8 Dashboard: Follow-Ups
const followUps = rows
    .filter(job => job.follow_up_date)
    .map(job => {
        const followUpStatus = getFollowUpStatus(job.follow_up_date);

        return {
            ...job,
            daysUntil: followUpStatus.daysUntil,
            followUpLabel: followUpStatus.label
        };
    })
    .filter(job => job.daysUntil <= 14)
    .sort((a, b) => a.daysUntil - b.daysUntil);

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
    </style>
</head>
<body>
    <nav>
        <a href="/jobs">View All Jobs</a> | 
        <a href="/add-job">Add New Job</a> |
        <a href="/help">Help</a>
    </nav>

    <hr>

    <h1>Career Tracker</h1>

<h2>Dashboard Overview</h2>

<div style="border:1px solid #999; padding:15px; margin-bottom:20px; background-color:#f9f9f9;">
    <p><strong>Total Applications:</strong> ${rows.length}</p>

    <h3>Applications by Status</h3>
    <ul>
        <li>Applied: ${statusCounts.Applied}</li>
        <li>Interview: ${statusCounts.Interview}</li>
        <li>Follow-Up: ${statusCounts['Follow-Up']}</li>
        <li>Offer: ${statusCounts.Offer}</li>
        <li>Rejected: ${statusCounts.Rejected}</li>
    </ul>

    <h3>Follow-Ups</h3>
    ${
        followUps.length === 0
        ? `<p>No follow-ups due or coming up in the next 14 days.</p>`
        : `
            <ul>
                ${followUps.map(job => `
                    <li>
                        <strong>${job.company_name}</strong> — ${job.job_title} 
                        on ${job.follow_up_date}
                        ${
                            job.daysUntil < 0
                            ? `<span class="past-due-label">(Past due by ${Math.abs(job.daysUntil)} day(s))</span>`
                            : job.daysUntil === 0 
                            ? '<strong>(Today)</strong>' 
                            : `(${job.daysUntil} day(s) away)`
                        }
                    </li>
                `).join('')}
            </ul>
        `
    }
</div>

<h2>Search and Filter Applications</h2>

    <form action="/jobs" method="GET" style="margin-bottom: 20px;">
        <input 
            type="text" 
            name="search" 
            placeholder="Search by company or job title"
            value="${search}"
            style="padding: 6px; width: 250px;"
        >

        <select name="status" style="padding: 6px;">
            <option value="">All Statuses</option>
            <option value="Applied" ${statusFilter === 'Applied' ? 'selected' : ''}>Applied</option>
            <option value="Interview" ${statusFilter === 'Interview' ? 'selected' : ''}>Interview</option>
            <option value="Follow-Up" ${statusFilter === 'Follow-Up' ? 'selected' : ''}>Follow-Up</option>
            <option value="Offer" ${statusFilter === 'Offer' ? 'selected' : ''}>Offer</option>
            <option value="Rejected" ${statusFilter === 'Rejected' ? 'selected' : ''}>Rejected</option>
        </select>

        <button type="submit" style="padding: 6px;">Search / Filter</button>
        <a href="/jobs" style="margin-left: 10px;">Clear Filters</a>
    </form>

    <p><strong>Results Found:</strong> ${rows.length}</p>
        `;

        if (rows.length === 0) {
            html += `
                <p style="font-weight: bold; color: #b00020;">
                    No matching applications found. Try clearing the filters or searching another company/job title.
                </p>
            `;
        } else {
            html += `
    <table border="1" cellpadding="8" style="border-collapse: collapse; width: 100%;">
        <thead>
            <tr style="background-color: #f2f2f2;">
                <th>Company</th>
                <th>Job Title</th>
                <th>Source</th>
                <th>Job Posting</th>
                <th>Resume Version</th>
                <th>Cover Letter Version</th>
                <th>Date Applied</th>
                <th>Status</th>
                <th>Follow-up Date</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            `;

            rows.forEach(job => {
                let rowStyle = '';
                let statusIcon = '';
                const followUpStatus = getFollowUpStatus(job.follow_up_date);

                if (job.status === 'Follow-Up') {
                    rowStyle = 'background-color: #fff3cd; font-weight: bold;';
                    statusIcon = '⚠️ ';
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
                    statusIcon = '⚠️ ';
                }

                html += `
            <tr style="${rowStyle}">
                <td>${job.company_name}</td>
                <td>${job.job_title}</td>
                <td>${job.application_source || 'N/A'}</td>
                <td>${job.job_url ? `<a href="${job.job_url}" target="_blank">View Posting</a>` : 'N/A'}</td>
                <td>${job.resume_version || 'N/A'}</td>
                <td>${job.cover_letter_version || 'N/A'}</td>
                <td>${job.application_date || 'N/A'}</td>

                <td>
                    <form action="/update-status/${job.id}" method="POST" style="margin:0;">
                        <select name="status" onchange="this.form.submit()">
                            <option value="Applied" ${job.status === 'Applied' ? 'selected' : ''}>Applied</option>
                            <option value="Interview" ${job.status === 'Interview' ? 'selected' : ''}>Interview</option>
                            <option value="Follow-Up" ${job.status === 'Follow-Up' ? 'selected' : ''}>Follow-Up</option>
                            <option value="Offer" ${job.status === 'Offer' ? 'selected' : ''}>Offer</option>
                            <option value="Rejected" ${job.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                        </select>
                        <span>${statusIcon}${job.status}</span>
                    </form>
                </td>

                <td>
                    <form action="/update-followup/${job.id}" method="POST" style="margin:0; display:flex; gap:5px;">
                        <input 
                            type="date" 
                            name="followUpDate" 
                            value="${job.follow_up_date || ''}"
                        >
                        <button type="submit" style="font-size:10px; cursor:pointer;">
                            Update
                        </button>
                    </form>
                    <small>${followUpStatus.label}</small>
                </td>

                <td>
                    <a href="/delete-job/${job.id}" 
                       onclick="return confirm('Are you sure you want to delete this application?')" 
                       style="color:red; text-decoration:none; font-weight:bold;">
                       [X] Delete
                    </a>
                </td>
            </tr>
                `;
            });

            html += `
        </tbody>
    </table>
            `;
        }

        html += `
    <br>
    <hr>

    <p><strong>Total Applications Displayed:</strong> ${rows.length}</p>

</body>
</html>
        `;

        res.send(html);
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

// Delete job
app.get('/delete-job/:id', (req, res) => {
    const jobId = req.params.id;

    const sql = 'DELETE FROM jobs WHERE id = ?';

    db.run(sql, jobId, (err) => {
        if (err) {
            console.error(err.message);
            res.status(500).send('Error deleting job');
        } else {
            console.log(`Job ID ${jobId} deleted successfully.`);
            res.redirect('/jobs');
        }
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
