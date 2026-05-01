const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const PORT = 3000;

// Middleware to help Express read form data
app.use(express.urlencoded({ extended: true }));

// Connect to the database
const db = new sqlite3.Database('./db/jobs.db', (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
    } else {
        console.log('Connected to SQLite database.');

        // 1. DATABASE TABLE SETUP
        db.run(`CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company TEXT NOT NULL,
            position TEXT NOT NULL,
            source TEXT,
            date_applied DATE,
            status TEXT DEFAULT 'Applied',
            follow_up_date DATE
        )`, (err) => {
            if (err) {
                console.error("Error creating table:", err.message);
            } else {
                console.log("Jobs table is ready and persistent.");
            }
        });
    }
});

// --- ROUTES ---

// Homepage Redirect (Optional but helpful)
app.get('/', (req, res) => {
    res.redirect('/jobs');
});

// 2. GET Route: Show the Manual Entry Form
app.get('/add-job', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'add-job.html'));
});

// 3. POST Route: Save form data to SQLite
app.post('/save-job', (req, res) => {
    const { companyName, jobTitle, applicationSource, applicationDate, status, followUpDate } = req.body;
    
    const sql = `INSERT INTO jobs (company, position, source, date_applied, status, follow_up_date) 
                 VALUES (?, ?, ?, ?, ?, ?)`;
    
    const params = [companyName, jobTitle, applicationSource, applicationDate, status, followUpDate];

    db.run(sql, params, (err) => {
        if (err) {
            console.error(err.message);
            res.status(500).send("Error saving to database");
        } else {
            console.log("New job entry saved!");
            res.redirect('/jobs'); 
        }
    });
});

// 4. GET Route: View all jobs in a Dashboard Table
app.get('/jobs', (req, res) => {
    const sql = "SELECT * FROM jobs";

    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).send("Error reading database");
        }

        let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Career Tracker - Dashboard</title>
</head>
<body>
    <nav>
        <a href="/jobs">View All Jobs</a> | 
        <a href="/add-job">Add New Job</a>
    </nav>
    <hr>
    <h1>Career Tracker</h1>
    <table border="1" cellpadding="8" style="border-collapse: collapse; width: 100%;">
        <thead>
            <tr style="background-color: #f2f2f2;">
                <th>Company</th>
                <th>Job Title</th>
                <th>Source</th>
                <th>Date Applied</th>
                <th>Status</th>
                <th>Follow-up Date</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>`;

        rows.forEach(job => {
            // We replace ${job.status} with this mini-form and select box
            html += `
            <tr>
                <td>${job.company}</td>
                <td>${job.position}</td>
                <td>${job.source || 'N/A'}</td>
                <td>${job.date_applied}</td>
                <td>
                    <form action="/update-status/${job.id}" method="POST" style="margin:0;">
                        <select name="status" onchange="this.form.submit()">
                            <option value="Applied" ${job.status === 'Applied' ? 'selected' : ''}>Applied</option>
                            <option value="Interview" ${job.status === 'Interview' ? 'selected' : ''}>Interview</option>
                            <option value="Follow-Up" ${job.status === 'Follow-Up' ? 'selected' : ''}>Follow-Up</option>
                            <option value="Offer" ${job.status === 'Offer' ? 'selected' : ''}>Offer</option>
                            <option value="Rejected" ${job.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                        </select>
                    </form>
                </td>
                <td>${job.follow_up_date || 'None Set'}</td>
                <td>
                    <a href="/delete-job/${job.id}" 
                       onclick="return confirm('Are you sure you want to delete this application?')" 
                       style="color: red; text-decoration: none; font-weight: bold;">
                       [X] Delete
                    </a>
                </td>
            </tr>`;
        });

        html += `
        </tbody>
    </table>
    <br>
    <hr>
    <p><strong>Total Applications:</strong> ${rows.length}</p>
</body>
</html>`;

        res.send(html);
    });
});

// 5. NEW DELETE ROUTE (Week 5)
app.get('/delete-job/:id', (req, res) => {
    const jobId = req.params.id;
    const sql = "DELETE FROM jobs WHERE id = ?";

    db.run(sql, jobId, (err) => {
        if (err) {
            console.error(err.message);
            res.status(500).send("Error deleting job");
        } else {
            console.log(`Job ID ${jobId} deleted successfully.`);
            res.redirect('/jobs'); 
        }
    });
});

// 6. NEW UPDATE STATUS ROUTE (Week 5)
app.post('/update-status/:id', (req, res) => {
    const jobId = req.params.id;
    const newStatus = req.body.status;
    const sql = "UPDATE jobs SET status = ? WHERE id = ?";

    db.run(sql, [newStatus, jobId], (err) => {
        if (err) {
            console.error(err.message);
            res.status(500).send("Error updating status");
        } else {
            console.log(`Job ${jobId} updated to ${newStatus}`);
            res.redirect('/jobs'); 
        }
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});