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

        // 1. UPDATED TABLE: Adding columns for Source and Follow-up
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
                console.log("Jobs table is ready with all student-level fields!");
            }
        });
    }
});

// --- ROUTES ---

// 2. GET Route: Show the Manual Entry Form
// This is the "Face" of the app.
app.get('/add-job', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'add-job.html'));
});

// 3. POST Route: Save the form data to SQLite
// This is the "Brain" that processes the Save button.
app.post('/save-job', (req, res) => {
    // Destructuring the data from your HTML form fields
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
            res.redirect('/jobs'); // Go to the list view to see your entry
        }
    });
});

// 4. GET Route: View all jobs as JSON
app.get('/jobs', (req, res) => {
    const sql = "SELECT * FROM jobs";

    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).send("Error reading database");
        }

        let html = `
            <!DOCTYPE html>
            <html>
            <body>
                <h1>Job Applications</h1>

                <a href="/add-job">Add New Job</a>

                <br><br>

                <table border="1" cellpadding="8">
                    <tr>
                        <th>Company</th>
                        <th>Job Title</th>
                        <th>Source</th>
                        <th>Date Applied</th>
                        <th>Status</th>
                    </tr>
        `;

        rows.forEach(job => {
            html += `
                <tr>
                    <td>${job.company}</td>
                    <td>${job.position}</td>
                    <td>${job.source}</td>
                    <td>${job.date_applied}</td>
                    <td>${job.status}</td>
                </tr>
            `;
        });

        html += `
                </table>
            </body>
            </html>
        `;

        res.send(html);
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});