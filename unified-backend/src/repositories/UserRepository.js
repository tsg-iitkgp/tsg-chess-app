/**
 * User Repository - PostgreSQL implementation
 * Replaces the Mongoose User model with direct PostgreSQL queries
 */

const { query, getClient } = require('../lib/db');

// Helper to convert snake_case DB rows to camelCase JS objects
const toCamelCase = (row) => {
    if (!row) return null;
    return {
        id: row.id,
        odId: row.id, // For compatibility
        userId: row.user_id,
        username: row.username,
        fullName: row.full_name,
        email: row.email,
        password: row.password,
        hallOfResidence: row.hall_of_residence,
        isOnline: row.is_online,
        bullet: row.bullet,
        blitz: row.blitz,
        rapid: row.rapid,
        puzzles: row.puzzles,
        gamesPlayed: row.games_played,
        gamesWon: row.games_won,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

class UserRepository {
    /**
     * Find user by userId
     */
    static async findByUserId(userId, excludePassword = true) {
        const fields = excludePassword
            ? 'id, user_id, username, full_name, email, hall_of_residence, is_online, bullet, blitz, rapid, puzzles, games_played, games_won, created_at, updated_at'
            : '*';

        const result = await query(
            `SELECT ${fields} FROM users WHERE user_id = $1`,
            [userId]
        );
        return toCamelCase(result.rows[0]);
    }

    /**
     * Find user by username
     */
    static async findByUsername(username, excludePassword = false) {
        const result = await query(
            'SELECT * FROM users WHERE username = $1',
            [username]
        );
        const user = toCamelCase(result.rows[0]);
        if (user && excludePassword) {
            delete user.password;
        }
        return user;
    }

    /**
     * Find user by username or email
     */
    static async findByUsernameOrEmail(username, email) {
        const result = await query(
            'SELECT * FROM users WHERE username = $1 OR LOWER(email) = LOWER($2)',
            [username, email]
        );
        return toCamelCase(result.rows[0]);
    }

    /**
     * Find user by login identifier (username or email)
     */
    static async findByLoginIdentifier(identifier) {
        const result = await query(
            'SELECT * FROM users WHERE username = $1 OR LOWER(email) = LOWER($1)',
            [identifier]
        );
        return toCamelCase(result.rows[0]);
    }

    /**
     * Search users by username (partial match)
     */
    static async searchByUsername(queryStr, limit = 10) {
        const result = await query(
            `SELECT user_id, username, is_online, bullet, blitz, rapid 
             FROM users 
             WHERE username ILIKE $1 
             ORDER BY username 
             LIMIT $2`,
            [`%${queryStr}%`, limit]
        );
        return result.rows.map(row => ({
            userId: row.user_id,
            username: row.username,
            isOnline: row.is_online,
            ratings: {
                bullet: row.bullet,
                blitz: row.blitz,
                rapid: row.rapid,
            }
        }));
    }

    /**
     * Create new user
     */
    static async create({ userId, username, fullName, email, password, hallOfResidence }) {
        const result = await query(
            `INSERT INTO users (user_id, username, full_name, email, password, hall_of_residence)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [userId, username, fullName, email, password, hallOfResidence]
        );
        const user = toCamelCase(result.rows[0]);
        delete user.password;
        return user;
    }

    /**
     * Update user fields
     */
    static async update(userId, updates) {
        const allowedFields = ['full_name', 'email', 'is_online', 'bullet', 'blitz', 'rapid', 'puzzles', 'games_played', 'games_won'];
        const fieldMapping = {
            fullName: 'full_name',
            email: 'email',
            isOnline: 'is_online',
            bullet: 'bullet',
            blitz: 'blitz',
            rapid: 'rapid',
            puzzles: 'puzzles',
            gamesPlayed: 'games_played',
            gamesWon: 'games_won',
        };

        const setClauses = [];
        const values = [];
        let paramIndex = 1;

        for (const [key, value] of Object.entries(updates)) {
            const dbField = fieldMapping[key];
            if (dbField && allowedFields.includes(dbField)) {
                setClauses.push(`${dbField} = $${paramIndex}`);
                values.push(value);
                paramIndex++;
            }
        }

        if (setClauses.length === 0) {
            return this.findByUserId(userId);
        }

        values.push(userId);
        const result = await query(
            `UPDATE users SET ${setClauses.join(', ')} WHERE user_id = $${paramIndex} RETURNING *`,
            values
        );
        const user = toCamelCase(result.rows[0]);
        if (user) delete user.password;
        return user;
    }

    /**
     * Set user online status
     */
    static async setOnline(userId, isOnline) {
        return this.update(userId, { isOnline });
    }

    /**
     * Reset all users to offline
     */
    static async resetAllToOffline() {
        await query('UPDATE users SET is_online = false');
    }

    /**
     * Update ratings after game
     */
    static async updateRatingAndStats(userId, { timeControlKey, newRating, isWin, ratingChange }) {
        const ratingField = timeControlKey; // bullet, blitz, rapid

        const result = await query(
            `UPDATE users 
             SET ${ratingField} = $1, 
                 games_played = games_played + 1,
                 games_won = games_won + $2
             WHERE user_id = $3 
             RETURNING *`,
            [newRating, isWin ? 1 : 0, userId]
        );
        const user = toCamelCase(result.rows[0]);
        if (user) delete user.password;
        return user;
    }

    /**
     * Get leaderboard by time control
     */
    static async getLeaderboard(timeControl, limit = 50) {
        const validTimeControls = ['bullet', 'blitz', 'rapid'];
        if (!validTimeControls.includes(timeControl)) {
            timeControl = 'blitz';
        }

        const result = await query(
            `SELECT user_id, username, ${timeControl} as rating, games_played, games_won
             FROM users
             WHERE games_played > 0
             ORDER BY ${timeControl} DESC, games_played DESC, username ASC
             LIMIT $1`,
            [limit]
        );

        return result.rows.map(row => ({
            userId: row.user_id,
            username: row.username,
            rating: row.rating,
            gamesPlayed: row.games_played,
            gamesWon: row.games_won,
        }));
    }

    /**
     * Find user by email
     */
    static async findByEmail(email) {
        const result = await query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );
        return toCamelCase(result.rows[0]);
    }

    /**
     * Save a hashed password reset token and its expiration
     */
    static async saveResetToken(userId, hashedToken, expiresAt) {
        await query(
            `UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE user_id = $3`,
            [hashedToken, expiresAt, userId]
        );
    }

    /**
     * Find a user by hashed reset token (must not be expired)
     */
    static async findByResetToken(hashedToken) {
        const result = await query(
            `SELECT * FROM users WHERE reset_password_token = $1 AND reset_password_expires > NOW()`,
            [hashedToken]
        );
        return toCamelCase(result.rows[0]);
    }

    /**
     * Update user password and clear reset token fields
     */
    static async updatePassword(userId, hashedPassword) {
        await query(
            `UPDATE users SET password = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE user_id = $2`,
            [hashedPassword, userId]
        );
    }
}

module.exports = UserRepository;
