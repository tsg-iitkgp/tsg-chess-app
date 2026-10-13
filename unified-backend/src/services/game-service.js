const { Chess } = require('chess.js');
const { v4: uuidv4 } = require('uuid');
const { redis } = require('../lib/db');
const UserRepository = require('../repositories/UserRepository');
const GameHistoryRepository = require('../repositories/GameHistoryRepository');
const { calculateRatingChange } = require('../lib/rating');

// Constants
const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Helper: Check if game has truly started
function hasGameStarted(gameState) {
    if (gameState.gameStarted === true) return true;
    if (gameState.gameStarted === false) return false;
    if (gameState.gameStarted === undefined) {
        return gameState.fen !== STARTING_FEN;
    }
    return false;
}

// Check if both players have made at least one move
function haveBothPlayersMoved(fen) {
    try {
        const fenParts = fen.trim().split(' ');
        if (fenParts.length < 6) return false;
        const fullmoveNumber = parseInt(fenParts[5], 10);
        return fullmoveNumber >= 2;
    } catch (e) {
        console.error('[GameService] Error parsing FEN for move count:', e);
        return false;
    }
}

// Extract moves from history
function extractMoveHistory(chess) {
    return chess.history({ verbose: true }).map(m => ({
        from: m.from,
        to: m.to,
        san: m.san,
        promotion: m.promotion,
    }));
}

// Generate PGN string from game data
function generatePGN({ whiteUsername, blackUsername, result, moves, timeControl, termination }) {
    const today = new Date();
    const dateStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;

    // Determine PGN result string
    let pgnResult = '*';
    if (result === 'white') {
        pgnResult = '1-0';
    } else if (result === 'black') {
        pgnResult = '0-1';
    } else if (result === 'draw') {
        pgnResult = '1/2-1/2';
    }

    // Build PGN headers
    const headers = [
        `[Event "TSG Chess Arena Game"]`,
        `[Site "TSG Chess Arena"]`,
        `[Date "${dateStr}"]`,
        `[White "${whiteUsername}"]`,
        `[Black "${blackUsername}"]`,
        `[Result "${pgnResult}"]`,
        `[TimeControl "${timeControl}"]`,
        `[Termination "${termination}"]`,
    ];

    // Build move text from moves array
    const moveHistory = moves || [];
    const moveLines = [];
    for (let i = 0; i < moveHistory.length; i += 2) {
        const moveNumber = Math.floor(i / 2) + 1;
        const whiteMove = moveHistory[i]?.san || '';
        const blackMove = moveHistory[i + 1]?.san || '';
        if (blackMove) {
            moveLines.push(`${moveNumber}. ${whiteMove} ${blackMove}`);
        } else if (whiteMove) {
            moveLines.push(`${moveNumber}. ${whiteMove}`);
        }
    }

    return `${headers.join('\n')}\n\n${moveLines.join(' ')} ${pgnResult}`;
}

async function createGame({ whitePlayerId, blackPlayerId, timeControl, timeControlKey, isFriendly = false }) {
    const gameId = uuidv4();
    const chess = new Chess();

    const gameState = {
        gameId,
        whitePlayerId,
        blackPlayerId,
        fen: chess.fen(),
        whiteTimeLeftMs: timeControl.initialMs,
        blackTimeLeftMs: timeControl.initialMs,
        incrementMs: timeControl.incrementMs || 0,
        timeControl,
        timeControlKey,
        isFriendly: !!isFriendly, // Ensure boolean
        createdAt: Date.now(),
        lastMoveTimestamp: Date.now(),
        gameStarted: false,
        moveHistory: [], // Store moves for incremental updates
    };

    await redis
        .multi()
        .set(`game:${gameId}`, JSON.stringify(gameState))
        .set(`player:game:${whitePlayerId}`, gameId)
        .set(`player:game:${blackPlayerId}`, gameId)
        .set(`activeGame:${whitePlayerId}`, gameId)
        .set(`activeGame:${blackPlayerId}`, gameId)
        .sadd('active_games', gameId)
        .exec();

    return gameState;
}

async function getGameState(gameId) {
    const data = await redis.get(`game:${gameId}`);
    return data ? JSON.parse(data) : null;
}

async function handlePlayerMove(gameId, playerId, move) {
    const lockKey = `lock:game:${gameId}`;
    const lock = await redis.set(lockKey, '1', 'NX', 'PX', 3000);
    if (!lock) return { error: 'Game busy' };

    try {
        const gameJSON = await redis.get(`game:${gameId}`);
        if (!gameJSON) return { error: 'Game not found' };

        const gameState = JSON.parse(gameJSON);
        const chess = new Chess(gameState.fen);

        // Turn validation
        const turn = chess.turn();
        if ((turn === 'w' && playerId !== gameState.whitePlayerId) ||
            (turn === 'b' && playerId !== gameState.blackPlayerId)) {
            return { error: 'Not your turn' };
        }

        // Time Calc
        const now = Date.now();
        const elapsed = now - gameState.lastMoveTimestamp;

        if (turn === 'w' && !gameState.gameStarted) {
            gameState.gameStarted = true;
        } else if (gameState.gameStarted) {
            if (turn === 'w') {
                gameState.whiteTimeLeftMs -= elapsed;
                if (gameState.whiteTimeLeftMs <= 0) return await handleGameOver(gameState, chess, 'timeout', 'black');
            } else {
                gameState.blackTimeLeftMs -= elapsed;
                if (gameState.blackTimeLeftMs <= 0) return await handleGameOver(gameState, chess, 'timeout', 'white');
            }
        }

        // Execute move
        const moveResult = chess.move(move);
        if (!moveResult) return { error: 'Illegal move' };

        // Increment
        if (gameState.incrementMs) {
            if (turn === 'w') gameState.whiteTimeLeftMs += gameState.incrementMs;
            else gameState.blackTimeLeftMs += gameState.incrementMs;
        }

        // Update State
        gameState.fen = chess.fen();
        gameState.lastMoveTimestamp = now;

        // Store the move for incremental updates
        if (!gameState.moveHistory) gameState.moveHistory = [];
        gameState.moveHistory.push({
            from: moveResult.from,
            to: moveResult.to,
            san: moveResult.san,
            promotion: moveResult.promotion,
            color: moveResult.color,
            piece: moveResult.piece,
            captured: moveResult.captured,
            timestamp: now,
        });

        // Check Game Over
        if (chess.isGameOver()) {
            return await handleGameOver(
                gameState,
                chess,
                getTerminationReason(chess),
                getWinner(chess)
            );
        }

        await redis.set(`game:${gameId}`, JSON.stringify(gameState));

        // Return the move details for incremental broadcast
        return {
            success: true,
            newState: gameState,
            move: {
                from: moveResult.from,
                to: moveResult.to,
                san: moveResult.san,
                promotion: moveResult.promotion,
                color: moveResult.color,
                piece: moveResult.piece,
                captured: moveResult.captured,
            }
        };

    } finally {
        await redis.del(lockKey);
    }
}

async function handleGameOver(gameState, chess, reason, winner) {
    console.log(`[DEBUG handleGameOver] Called with reason: ${reason}, winner: ${winner}`);

    const endedKey = `game:ended:${gameState.gameId}`;
    const alreadyEnded = await redis.get(endedKey);
    if (alreadyEnded) return { gameOver: true, outcome: { winner, reason } };

    await redis.set(endedKey, '1', 'EX', 120);

    const bothPlayersMoved = haveBothPlayersMoved(gameState.fen);
    let ratingUpdates = null;

    if (bothPlayersMoved) {
        console.log(`[DEBUG handleGameOver] Calculating rating changes...`);
        ratingUpdates = await updateRatingsAndHistory(gameState, winner, reason, chess);
    } else {
        console.log(`[GameService] Game ended without rating change - not enough moves`);
    }

    const outcome = {
        winner,
        reason,
        noRatingChange: !bothPlayersMoved,
        whiteRatingChange: ratingUpdates?.whiteRatingChange || 0,
        blackRatingChange: ratingUpdates?.blackRatingChange || 0,
        whiteRating: ratingUpdates?.newWhiteRating,
        blackRating: ratingUpdates?.newBlackRating,
    };

    // Cleanup Redis
    await redis.del(`game:${gameState.gameId}`);
    await redis
        .multi()
        .srem('active_games', gameState.gameId)
        .del(`player:game:${gameState.whitePlayerId}`)
        .del(`player:game:${gameState.blackPlayerId}`)
        .del(`activeGame:${gameState.whitePlayerId}`)
        .del(`activeGame:${gameState.blackPlayerId}`)
        .set(`player:state:${gameState.whitePlayerId}`, 'IDLE')
        .set(`player:state:${gameState.blackPlayerId}`, 'IDLE')
        .exec();

    return { success: true, gameOver: true, outcome };
}

async function resignGame(gameId, playerId) {
    const gameJSON = await redis.get(`game:${gameId}`);
    if (!gameJSON) return { error: 'Game not found' };

    const gameState = JSON.parse(gameJSON);

    if (gameState.whitePlayerId !== playerId && gameState.blackPlayerId !== playerId) {
        return { error: 'Not a player in this game' };
    }

    const endedKey = `game:ended:${gameId}`;
    if (await redis.get(endedKey)) return { error: 'Game already ended' };

    const winner = playerId === gameState.whitePlayerId ? 'black' : 'white';
    const chess = new Chess(gameState.fen);

    return await handleGameOver(gameState, chess, 'resignation', winner);
}

async function claimTimeout(gameId, claimantId) {
    const lockKey = `lock:game:${gameId}`;
    const lock = await redis.set(lockKey, '1', 'NX', 'PX', 3000);
    if (!lock) return { error: 'Game busy' };

    try {
        const gameJSON = await redis.get(`game:${gameId}`);
        if (!gameJSON) return { error: 'Game not found' };

        const gameState = JSON.parse(gameJSON);
        const chess = new Chess(gameState.fen);

        const now = Date.now();
        const elapsed = now - gameState.lastMoveTimestamp;
        const turn = chess.turn();

        let whiteTime = gameState.whiteTimeLeftMs;
        let blackTime = gameState.blackTimeLeftMs;

        if (turn === 'w') whiteTime -= elapsed;
        else blackTime -= elapsed;

        if (turn === 'w' && whiteTime > 0) return { error: 'White still has time' };
        if (turn === 'b' && blackTime > 0) return { error: 'Black still has time' };

        const winnerColor = turn === 'w' ? 'black' : 'white';
        return await handleGameOver(gameState, chess, 'timeout', winnerColor);

    } finally {
        await redis.del(lockKey);
    }
}

async function updateRatingsAndHistory(gameState, winner, reason, chess) {
    console.log(`[DEBUG updateRatingsAndHistory] Called with winner: ${winner}, reason: ${reason}, isFriendly: ${gameState.isFriendly}`);

    const whiteUser = await UserRepository.findByUserId(gameState.whitePlayerId, false);
    const blackUser = await UserRepository.findByUserId(gameState.blackPlayerId, false);

    if (!whiteUser || !blackUser) {
        console.log(`[DEBUG updateRatingsAndHistory] User not found!`);
        return null;
    }

    const timeControlKey = gameState.timeControlKey || 'rapid';
    const finalFen = gameState.fen;
    const moves = gameState.moveHistory || [];

    // Generate PGN for this game
    const pgn = generatePGN({
        whiteUsername: whiteUser.username,
        blackUsername: blackUser.username,
        result: winner,
        moves,
        timeControl: timeControlKey,
        termination: reason,
    });

    let whiteChange = 0;
    let blackChange = 0;
    let newWhiteRating = whiteUser[timeControlKey] || 1200;
    let newBlackRating = blackUser[timeControlKey] || 1200;

    // Only calculate and update ratings if NOT friendly
    if (!gameState.isFriendly) {
        const whiteRating = whiteUser[timeControlKey] || 1200;
        const blackRating = blackUser[timeControlKey] || 1200;

        let whiteScore = 0.5;
        if (winner === 'white') whiteScore = 1;
        else if (winner === 'black') whiteScore = 0;

        whiteChange = calculateRatingChange(whiteRating, blackRating, whiteScore);
        blackChange = calculateRatingChange(blackRating, whiteRating, 1 - whiteScore);

        newWhiteRating = whiteRating + whiteChange;
        newBlackRating = blackRating + blackChange;

        // Update White user rating and stats
        await UserRepository.updateRatingAndStats(gameState.whitePlayerId, {
            timeControlKey,
            newRating: newWhiteRating,
            isWin: winner === 'white',
            ratingChange: whiteChange,
        });

        // Update Black user rating and stats
        await UserRepository.updateRatingAndStats(gameState.blackPlayerId, {
            timeControlKey,
            newRating: newBlackRating,
            isWin: winner === 'black',
            ratingChange: blackChange,
        });

        console.log(`[GameService] Ratings updated. White: ${whiteRating}->${newWhiteRating}, Black: ${blackRating}->${newBlackRating}`);
    } else {
        console.log(`[GameService] Friendly game - skipping rating updates. code: 200`);
    }

    // Add to game history for both players
    await GameHistoryRepository.addGameToHistory({
        userId: gameState.whitePlayerId,
        gameId: gameState.gameId,
        opponentUserId: gameState.blackPlayerId,
        opponentUsername: blackUser.username,
        result: winner === 'white' ? 'won' : winner === 'draw' ? 'draw' : 'lost',
        ratingChange: whiteChange,
        timeControl: timeControlKey,
        termination: reason,
        finalFen,
        moves,
        pgn,
        isFriendly: gameState.isFriendly,
    });

    await GameHistoryRepository.addGameToHistory({
        userId: gameState.blackPlayerId,
        gameId: gameState.gameId,
        opponentUserId: gameState.whitePlayerId,
        opponentUsername: whiteUser.username,
        result: winner === 'black' ? 'won' : winner === 'draw' ? 'draw' : 'lost',
        ratingChange: blackChange,
        timeControl: timeControlKey,
        termination: reason,
        finalFen,
        moves,
        pgn,
        isFriendly: gameState.isFriendly,
    });

    return {
        whiteRatingChange: whiteChange,
        blackRatingChange: blackChange,
        newWhiteRating,
        newBlackRating,
        isFriendly: gameState.isFriendly
    };
}



function getTerminationReason(chess) {
    if (chess.isCheckmate()) return 'checkmate';
    if (chess.isStalemate()) return 'stalemate';
    if (chess.isThreefoldRepetition()) return 'repetition';
    if (chess.isInsufficientMaterial()) return 'insufficient material';
    if (chess.isDraw()) return 'draw by 50-move rule';
    return 'unknown';
}

function getWinner(chess) {
    if (!chess.isGameOver()) return null;
    if (chess.isCheckmate()) return chess.turn() === 'w' ? 'black' : 'white';
    return 'draw';
}

module.exports = {
    createGame,
    getGameState,
    handlePlayerMove,
    handleGameOver,
    resignGame,
    claimTimeout
};
