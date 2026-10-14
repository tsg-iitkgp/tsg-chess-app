const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const UserRepository = require('../repositories/UserRepository');
const { JWT_SECRET } = require('../middleware/auth');
const { sendPasswordResetEmail } = require('../services/emailService');

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Register
router.post('/register', async (req, res) => {
    try {
        let { username, fullName, email, password, hallOfResidence } = req.body;
        if (!username || !email || !password || !hallOfResidence) {
            return res.status(400).json({ error: 'Username, email, password, and hall of residence are required' });
        }

        // Validate email domain
        if (!email.endsWith('@kgpian.iitkgp.ac.in')) {
            return res.status(400).json({ error: 'Please use your IIT KGP email ID (@kgpian.iitkgp.ac.in)' });
        }

        // Validate username: no spaces, convert to lowercase
        if (/\s/.test(username)) {
            return res.status(400).json({ error: 'Username cannot contain spaces' });
        }
        username = username.toLowerCase();

        const existingUser = await UserRepository.findByUsernameOrEmail(username, email);
        if (existingUser) {
            return res.status(409).json({ error: 'Username or email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = uuidv4();

        const user = await UserRepository.create({
            userId,
            username,
            fullName,
            email,
            password: hashedPassword,
            hallOfResidence,
        });

        const token = jwt.sign({ userId, username, email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        res.status(201).json({ message: 'User created', user, token });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Required fields missing' });
        }

        // Accept username or email as the login identifier
        const identifier = username.trim().toLowerCase();
        const user = await UserRepository.findByLoginIdentifier(identifier);
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Validate email domain
        if (!user.email.endsWith('@kgpian.iitkgp.ac.in')) {
            return res.status(403).json({ error: 'Access restricted to @kgpian.iitkgp.ac.in emails' });
        }

        await UserRepository.setOnline(user.userId, true);

        const token = jwt.sign(
            { userId: user.userId, username: user.username, email: user.email },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        // Remove password from response
        delete user.password;
        res.json({ message: 'Login successful', user, token });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Forgot Password
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const user = await UserRepository.findByEmail(email);

        // Always return success to prevent email enumeration attacks
        if (!user) {
            return res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
        }

        // Generate a random token and hash it for storage
        const resetToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

        // Token expires in 1 hour
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

        await UserRepository.saveResetToken(user.userId, hashedToken, expiresAt);

        // Send the unhashed token in the email link
        await sendPasswordResetEmail(email, resetToken);

        res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) {
            return res.status(400).json({ error: 'Token and new password are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        // Hash the incoming token with SHA-256 to compare with the stored hash
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        const user = await UserRepository.findByResetToken(hashedToken);
        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await UserRepository.updatePassword(user.userId, hashedPassword);

        res.json({ message: 'Password has been reset successfully. You can now log in.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
