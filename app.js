const express = require('express');
const mysql = require('mysql');
const session = require('express-session');
const bodyParser = require('body-parser');
const emailService = require('./emailService');
const con = require('./models/db.js');  // Import database connection
const app = express();
const crypto = require('crypto');


const sendConfirmationEmail = (email, activationCode) => {
    const activationLink = `http://localhost:3001/activate?code=${activationCode}&email=${encodeURIComponent(email)}`;
    const subject = 'Activate Your Account';
    const message = `Please click the following link to activate your account: ${activationLink}`;

    return emailService.sendMail(email, subject, message)
        .then(() => console.log(`Activation email sent to ${email}`))
        .catch((err) => {
            console.error(`Failed to send activation email: ${err.message}`);
            throw new Error('Failed to send activation email.');
        });
};

// Setup Static Files (CSS)
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

// Set up EJS as the view engine
app.set('view engine', 'ejs');

// Set up session management
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true
}));

// Route to display the main page (machines)
app.get('/', (req, res) => {
    const userAuthenticated = req.session.user ? true : false;
    con.query('SELECT * FROM machines', (err, machines) => {
        if (err) throw err;
        res.render('index', { machines: machines, userAuthenticated: userAuthenticated });
    });
});


//Register functionality
app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/register', (req, res) => {
    const { firstName, lastName, email, password } = req.body;
    const activationCode = Math.random().toString(36).substring(2, 12);

    con.query('SELECT * FROM users WHERE email = ?', [email], (err, result) => {
        if (err) {
            console.log('Error querying database:', err);
            res.redirect('/register?error=Database query error. Please try again.');
        } else if (result.length > 0) {
            res.redirect('/register?error=Email already registered.');
        } else {
            con.query('INSERT INTO users (firstName, lastName, email, password, activationCode) VALUES (?, ?, ?, ?, ?)', 
            [firstName, lastName, email, password, activationCode], (err, result) => {
                if (err) {
                    console.log('Error inserting user into database:', err);
                    res.redirect('/register?error=Registration failed. Please try again.');
                } else {
                    sendConfirmationEmail(email, activationCode)
                        .then(() => {
                            res.redirect('/login?message=Please check your email to activate your account.');
                        })
                        .catch(() => {
                            res.redirect('/register?error=Failed to send activation email. Please try again.');
                        });
                }
            });
        }
    });
});


//For activation of account
app.get('/activate', (req, res) => {
    const { email, code } = req.query;
    con.query('SELECT * FROM users WHERE email = ? AND activationCode = ?', [email, code], (err, result) => {
        if (err) {
            console.log('Error querying database:', err);
            return res.send('Activation failed. Please try again later.');
        }

        if (result.length === 0) {
            return res.send('Invalid activation link or account already activated.');
        }

        con.query('UPDATE users SET isActive = 1 WHERE email = ?', [email], (err, updateResult) => {
            if (err) {
                console.log('Error updating database:', err);
                return res.send('Activation failed. Please try again later.');
            }

            res.send('Your account has been successfully activated. You can now <a href="/login">log in</a>.');
        });
    });
});


// Login Route
app.get('/login', (req, res) => {
    res.render('login', { message: req.query.message });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    con.query('SELECT * FROM users WHERE email = ?', [email], (err, result) => {
        if (err) {
            console.error('Error querying database:', err);
            return res.redirect('/login?message=Database error. Please try again.');
        }

        if (result.length === 0) {
            // No user found
            return res.redirect('/login?message=Invalid email or password.');
        }

        const user = result[0];
        if (user.password !== password) {
            // Incorrect password
            return res.redirect('/login?message=Invalid email or password.');
        }

        if (user.isActive !== 1) {
            // User account not activated
            return res.redirect('/login?message=Only active users can log in.');
        }

        // Successful login
        req.session.user = user;
        res.redirect('/');
    });
});

//Forgot-password

app.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { message: req.query.message || '' });
});


app.post('/forgot-password', (req, res) => {
    const { email } = req.body;

    // Check if the email exists in the database
    con.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.redirect('/forgot-password?message=An error occurred. Please try again.');
        }

        if (results.length === 0) {
            return res.redirect('/forgot-password?message=No user found with that email.');
        }

        // Generate a reset code and save it to the database
        const resetCode = crypto.randomBytes(20).toString('hex');
        con.query('UPDATE users SET resetCode = ? WHERE email = ?', [resetCode, email], (err) => {
            if (err) {
                console.error('Error updating reset code:', err);
                return res.redirect('/forgot-password?message=Failed to generate reset code.');
            }

            // Send the reset password email
            const resetLink = `http://localhost:3001/reset-password?code=${resetCode}&email=${encodeURIComponent(email)}`;
            const subject = 'Reset Your Password';
            const message = `Click the link to reset your password: ${resetLink}`;

            emailService.sendMail(email, subject, message)
                .then(() => {
                    res.redirect('/login?message=Reset link sent. Check your email.');
                })
                .catch((err) => {
                    console.error('Failed to send email:', err);
                    res.redirect('/forgot-password?message=Failed to send reset email.');
                });
        });
    });
});


// Display Reset Password Form
app.get('/reset-password', (req, res) => {
    const { email, code } = req.query;

    // Verify reset code
    con.query('SELECT * FROM users WHERE email = ? AND resetCode = ?', [email, code], (err, results) => {
        if (err || results.length === 0) {
            console.error('Invalid or expired reset code.');
            return res.status(400).send('Invalid or expired reset link.');
        }

        res.render('reset-password', { email, code });
    });
});

// Handle New Password Submission
app.post('/reset-password', (req, res) => {
    const { email, code, newPassword } = req.body;

    // Verify reset code again
    con.query('SELECT * FROM users WHERE email = ? AND resetCode = ?', [email, code], (err, results) => {
        if (err || results.length === 0) {
            console.error('Invalid or expired reset code.');
            return res.status(400).send('Invalid or expired reset link.');
        }

        // Update the password and clear the reset code
        con.query('UPDATE users SET password = ?, resetCode = NULL WHERE email = ?', [newPassword, email], (err) => {
            if (err) {
                console.error('Error updating password:', err);
                return res.status(500).send('Failed to reset password. Please try again.');
            }

            res.redirect('/login?message=Password reset successful. You can now log in.');
        });
    });
});



// Route to reserve a machine (handled as a post request)
app.post('/reserve', (req, res) => {
    const machine_id = req.body.machineID;
    const user_id = req.session.user.ID;
    const start_time = new Date(req.body.startTime);
    const end_time = new Date(new Date(start_time).getTime() + 60 * 60 * 1000);

    // Check for overlapping reservations
    const checkQuery = `
      SELECT * FROM reservations
      WHERE machine_id = ?
        AND ((start_time <= ? AND end_time > ?)   -- Overlaps the new start_time
          OR (start_time < ? AND end_time >= ?)) -- Overlaps the new end_time
    `;

    con.query(checkQuery, [machine_id, end_time, start_time, start_time, end_time], (err, results) => {
        if (err) return res.status(500).send('Error checking reservations: ' + err.message);

        if (results.length > 0) {
            // return res.status(400).send('Time slot already reserved for this machine.');
            return res.send('<script>alert("Time slot already reserved for this machine!"); window.history.back();</script>');
        }

        // If no conflicts, insert reservation
        const query = `
        INSERT INTO reservations (user_id, machine_id, start_time, end_time)
        VALUES (?, ?, ?, ?)
      `;

        con.query(query, [user_id, machine_id, start_time, end_time], (err, result) => {
            if (err) {
                return res.send('<script>alert("Error creating reservation: ' + err.message + '"); window.history.back();</script>');
            }
            res.send('<script>alert("Reservation created successfully!"); window.history.back();</script>');
        });

    });
});


// Route to view reservations
app.get('/reservations', (req, res) => {
    if (!req.session.user) {
        res.redirect('/login');
    } else {
        const query = `
            SELECT r.*, m.name AS machineName, m.floor AS machineFloor 
            FROM reservations r
            JOIN machines m ON r.machine_id = m.ID
            WHERE r.user_id = ?
            ORDER BY r.start_time DESC
        `;
        con.query(query, [req.session.user.ID], (err, reservations) => {
            if (err) throw err;
            res.render('reservations', { reservations: reservations });
        });
    }
});

// Route to handle user logout
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) throw err;
        res.redirect('/login');
    });
});

// Start the server
const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
