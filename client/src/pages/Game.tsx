import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { ChessBoard } from "@/components/chess/ChessBoard";
import { PlayerInfo } from "@/components/chess/PlayerInfo";
import { GamePanel } from "@/components/chess/GamePanel";
import type { Move as MoveListMove } from "@/components/chess/MoveList";
import { useAuth } from "@/hooks/use-auth";
import * as api from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { Chess, Move } from "chess.js";
import { Button } from "@/components/ui/button";
import { useSocket } from "@/context/SocketContext";
import { Download, Share2 } from "lucide-react";

const boardColorMap: Record<string, { light: string; dark: string; highlight: string }> = {
  "blue-marble.jpg": { light: "210 80% 86%", dark: "210 85% 40%", highlight: "50 100% 60%" },
  "blue.png": { light: "210 80% 85%", dark: "215 85% 38%", highlight: "50 100% 60%" },
  "wood3.jpg": { light: "38 42% 85%", dark: "32 56% 47%", highlight: "50 100% 60%" },
  "canvas2.jpg": { light: "51 24% 85%", dark: "53 46% 38%", highlight: "50 100% 60%" },
  default: { light: "210 30% 85%", dark: "210 70% 50%", highlight: "50 100% 60%" },
};

const Game = () => {
  const { socket, isConnected } = useSocket();
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();

  // Game state
  const [gameState, setGameState] = useState<api.GameState | null>(null);
  const [displayFen, setDisplayFen] = useState<string>("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moves, setMoves] = useState<MoveListMove[]>([]);
  const [theme, setTheme] = useState("cardinal");
  const [board, setBoard] = useState("wood.jpg");
  const [whiteTimeLeft, setWhiteTimeLeft] = useState(0);
  const [blackTimeLeft, setBlackTimeLeft] = useState(0);
  const [gameOver, setGameOver] = useState<{
    winner: string;
    reason: string;
    noRatingChange?: boolean;
    whiteRatingChange?: number;
    blackRatingChange?: number;
  } | null>(null);
  const [gameNotFound, setGameNotFound] = useState(false);
  const [whitePlayerInfo, setWhitePlayerInfo] = useState<{ username: string; rating: number } | null>(null);
  const [blackPlayerInfo, setBlackPlayerInfo] = useState<{ username: string; rating: number } | null>(null);
  const [pendingMove, setPendingMove] = useState<{ from: string; to: string } | null>(null);
  const [showResignConfirm, setShowResignConfirm] = useState(false);

  // Chess instances
  const chess = useMemo(() => new Chess(), []);
  const chessHistory = useRef<Chess>(new Chess());

  // Memoized player names (computed early for use in callbacks)
  const isUserWhite = useMemo(
    () => user?.userId === gameState?.whitePlayerId,
    [user?.userId, gameState?.whitePlayerId],
  );
  const isUserBlack = useMemo(
    () => user?.userId === gameState?.blackPlayerId,
    [user?.userId, gameState?.blackPlayerId],
  );
  const whitePlayerName = useMemo(
    () => whitePlayerInfo?.username || (isUserWhite && user ? user.username : "Opponent"),
    [whitePlayerInfo?.username, isUserWhite, user],
  );
  const blackPlayerName = useMemo(
    () => blackPlayerInfo?.username || (isUserBlack && user ? user.username : "Opponent"),
    [blackPlayerInfo?.username, isUserBlack, user],
  );

  // Timer refs
  const whiteBaseRef = useRef<number>(0);
  const blackBaseRef = useRef<number>(0);
  const tsBaseRef = useRef<number>(0);
  const fenBaseRef = useRef<string>("");
  const gameStartedRef = useRef<boolean>(false);

  // Track if initial fetch is done
  const initialFetchDone = useRef(false);
  const claimingTimeoutRef = useRef(false);

  // Sync moves from FEN
  const syncMovesFromFen = useCallback((targetFen: string) => {
    const historyChess = chessHistory.current;
    const beforeFen = historyChess.fen();
    if (beforeFen === targetFen) return;

    const legalMoves = historyChess.moves({ verbose: true }) as Move[];
    let applied = false;

    for (const move of legalMoves) {
      historyChess.move(move);
      if (historyChess.fen() === targetFen) {
        applied = true;
        break;
      }
      historyChess.undo();
    }

    if (applied) {
      const history = historyChess.history({ verbose: true }) as Move[];
      const movesList: MoveListMove[] = [];
      for (let i = 0; i < history.length; i += 2) {
        const whiteMove = history[i];
        const blackMove = history[i + 1];
        movesList.push({
          number: Math.floor(i / 2) + 1,
          white: whiteMove.san,
          black: blackMove?.san,
        });
      }
      setMoves(movesList);
    } else {
      chessHistory.current = new Chess(targetFen);
      setMoves([]);
    }
  }, []);

  // Compute times - called every 100ms by timer
  const computeTimes = useCallback(() => {
    const ts = tsBaseRef.current;
    if (!ts || gameOver) return;

    if (!gameStartedRef.current) {
      setWhiteTimeLeft(whiteBaseRef.current);
      setBlackTimeLeft(blackBaseRef.current);
      return;
    }

    let isWhiteTurnLocal = true;
    try {
      chess.load(fenBaseRef.current);
      isWhiteTurnLocal = chess.turn() === "w";
    } catch {
      void 0;
    }

    const elapsed = Date.now() - ts;
    if (isWhiteTurnLocal) {
      setWhiteTimeLeft(Math.max(0, whiteBaseRef.current - elapsed));
      setBlackTimeLeft(blackBaseRef.current);
    } else {
      setBlackTimeLeft(Math.max(0, blackBaseRef.current - elapsed));
      setWhiteTimeLeft(whiteBaseRef.current);
    }
  }, [gameOver, chess]);

  // Set board colors
  useEffect(() => {
    const colors = boardColorMap[board] || boardColorMap["default"];
    const root = document.documentElement;
    root.style.setProperty("--chess-light", colors.light);
    root.style.setProperty("--chess-dark", colors.dark);
    root.style.setProperty("--chess-highlight", colors.highlight);
  }, [board]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login");
    }
  }, [isAuthenticated, navigate]);

  // INITIAL FETCH - runs ONCE when component mounts
  useEffect(() => {
    if (!gameId || !isAuthenticated || !user || initialFetchDone.current) {
      return;
    }

    const fetchGameState = async () => {
      try {
        setLoading(true);
        const token = localStorage.getItem("auth_token");
        if (!token) throw new Error("No token");

        const state = await api.getGameState(token, gameId);
        setGameState(state);
        setDisplayFen(state.fen);
        whiteBaseRef.current = state.whiteTimeLeftMs;
        blackBaseRef.current = state.blackTimeLeftMs;
        tsBaseRef.current = state.lastMoveTimestamp;
        fenBaseRef.current = state.fen;
        gameStartedRef.current = state.gameStarted ?? false;
        chess.load(state.fen);
        syncMovesFromFen(state.fen);

        // Fetch player info
        try {
          const [whitePlayer, blackPlayer] = await Promise.all([
            api.getUserById(state.whitePlayerId, token),
            api.getUserById(state.blackPlayerId, token),
          ]);
          const timeKey = state.timeControlKey as "bullet" | "blitz" | "rapid";
          setWhitePlayerInfo({ username: whitePlayer.username, rating: whitePlayer[timeKey] ?? 1200 });
          setBlackPlayerInfo({ username: blackPlayer.username, rating: blackPlayer[timeKey] ?? 1200 });
        } catch {
          // Fallback
        }

        initialFetchDone.current = true;
      } catch (err: unknown) {
        const error = err as Error;
        console.error("[Game] Initial fetch error:", error);
        setError(error.message);
        setGameNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    fetchGameState();
  }, [gameId, isAuthenticated, user, chess, syncMovesFromFen]);

  // Ref for latest game stat to access inside listeners without re-binding
  const gameStateRef = useRef<api.GameState | null>(null);

  // Update ref whenever state changes
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // WebSocket event handlers - NO POLLING, just subscribe to events
  useEffect(() => {
    if (!gameId || !socket || !isConnected || !user?.userId) {
      return;
    }

    console.log("[Game] Setting up WebSocket listeners for game:", gameId);

    // Join game room
    socket.emit("join_game", gameId);

    const onGameState = (newState: api.GameState) => {
      console.log("[Game] Received game_state via WebSocket");
      setGameState(newState);
      // gameStateRef is updated via effect, but for immediate use in this closure valid next tick
      // But here we set explicit refs
      setDisplayFen(newState.fen);
      whiteBaseRef.current = newState.whiteTimeLeftMs;
      blackBaseRef.current = newState.blackTimeLeftMs;
      tsBaseRef.current = newState.lastMoveTimestamp;
      fenBaseRef.current = newState.fen;
      gameStartedRef.current = newState.gameStarted ?? false;
      syncMovesFromFen(newState.fen);
      setPendingMove(null);
      setLoading(false);
    };

    const onMoveMade = (payload: {
      gameId: string;
      move: { from: string; to: string; san: string };
      fen: string;
      whiteTimeLeftMs: number;
      blackTimeLeftMs: number;
      lastMoveTimestamp: number;
      gameStarted: boolean;
    }) => {
      if (payload.gameId !== gameId) return;
      console.log("[Game] Received move_made:", payload.move.san);

      const newState = {
        ...(gameStateRef.current || {}),
        fen: payload.fen,
        whiteTimeLeftMs: payload.whiteTimeLeftMs,
        blackTimeLeftMs: payload.blackTimeLeftMs,
        lastMoveTimestamp: payload.lastMoveTimestamp,
        gameStarted: payload.gameStarted,
      } as api.GameState;

      setGameState(newState); // Triggers ref update

      setDisplayFen(payload.fen);
      fenBaseRef.current = payload.fen;
      whiteBaseRef.current = payload.whiteTimeLeftMs;
      blackBaseRef.current = payload.blackTimeLeftMs;
      tsBaseRef.current = payload.lastMoveTimestamp;
      gameStartedRef.current = payload.gameStarted;

      syncMovesFromFen(payload.fen);
      setPendingMove(null);
    };

    const onMoveError = (payload: { error: string; move: { from: string; to: string } }) => {
      console.error("[Game] Move error:", payload.error);

      // If game not found, it might have ended.
      if (payload.error === "Game not found") {
        // Do not show destructive toast loop if game is actually over?
        // If we have local state, assume it ended?
        // But usually we get game_over event.
      }

      if (gameStateRef.current) {
        setDisplayFen(gameStateRef.current.fen);
      }
      setPendingMove(null);
      toast({
        title: "Invalid Move",
        description: payload.error,
        variant: "destructive",
      });
    };

    const onGameOver = (outcome: {
      winner: string;
      reason: string;
      noRatingChange?: boolean;
      whiteRatingChange?: number;
      blackRatingChange?: number;
    }) => {
      console.log("[Game] Game over:", outcome);
      setGameOver(outcome);
      // Permanently stop timeout claiming
      claimingTimeoutRef.current = true;
    };

    socket.on("game_state", onGameState);
    socket.on("move_made", onMoveMade);
    socket.on("move_error", onMoveError);
    socket.on("game_over", onGameOver);

    return () => {
      console.log("[Game] Cleaning up WebSocket listeners");
      socket.off("game_state", onGameState);
      socket.off("move_made", onMoveMade);
      socket.off("move_error", onMoveError);
      socket.off("game_over", onGameOver);
      socket.emit("leave_game", gameId);
    };
  }, [gameId, socket, isConnected, user?.userId, syncMovesFromFen]); // Removed gameState dependency

  // Timer interval - ONLY for updating clock display, NOT for fetching state
  useEffect(() => {
    if (gameOver) return;

    const interval = setInterval(() => {
      computeTimes();

      // Check for timeout
      if (!gameId || !user || !gameStartedRef.current) return;
      const ts = tsBaseRef.current;
      if (!ts) return;

      let isWhiteTurnLocal = true;
      try {
        const tempChess = new Chess(fenBaseRef.current);
        isWhiteTurnLocal = tempChess.turn() === "w";
      } catch {
        return;
      }

      const elapsed = Date.now() - ts;
      const timeLeft =
        isWhiteTurnLocal ? Math.max(0, whiteBaseRef.current - elapsed) : Math.max(0, blackBaseRef.current - elapsed);

      if (timeLeft <= 0 && !claimingTimeoutRef.current) {
        claimingTimeoutRef.current = true;
        console.log("[Game] Claiming timeout...");
        const token = localStorage.getItem("auth_token");
        if (token) {
          api
            .claimTimeout(gameId, token)
            .then(() => console.log("Timeout claimed"))
            .catch((e) => console.error("Claim failed", e))
            .finally(() => {
              // Only reset if game is not over yet
              if (!gameOver) {
                setTimeout(() => {
                  claimingTimeoutRef.current = false;
                }, 5000);
              }
            });
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [gameOver, computeTimes, gameId, user]);

  // Handle move attempt with OPTIMISTIC UPDATE
  const handleMoveAttempt = async (move: { from: string; to: string; promotion?: string }) => {
    if (!gameId || !user || !gameState || gameOver) return;

    try {
      chess.load(gameState.fen);
    } catch (e) {
      console.error("Failed to load FEN:", e);
      return;
    }

    const turn = chess.turn();
    const isWhiteTurn = turn === "w";
    const isUserWhite = user.userId === gameState.whitePlayerId;
    const isUserBlack = user.userId === gameState.blackPlayerId;

    if ((isWhiteTurn && !isUserWhite) || (!isWhiteTurn && !isUserBlack)) {
      toast({
        title: "Not your turn",
        description: "Please wait for your opponent to move",
        variant: "destructive",
      });
      return;
    }

    // OPTIMISTIC UPDATE
    try {
      const localChess = new Chess(gameState.fen);
      const result = localChess.move(move);
      if (result) {
        setDisplayFen(localChess.fen());
        setPendingMove({ from: move.from, to: move.to });

        const updatedHistory = localChess.history({ verbose: true }) as Move[];
        const movesList: MoveListMove[] = [];
        for (let i = 0; i < updatedHistory.length; i += 2) {
          const whiteMove = updatedHistory[i];
          const blackMove = updatedHistory[i + 1];
          movesList.push({
            number: Math.floor(i / 2) + 1,
            white: whiteMove.san,
            black: blackMove?.san,
          });
        }
        setMoves(movesList);
      }
    } catch {
      return;
    }

    // Send via WebSocket
    if (socket && socket.connected) {
      socket.emit("move", {
        gameId,
        move: {
          from: move.from,
          to: move.to,
          promotion: move.promotion,
        },
      });
    } else {
      setDisplayFen(gameState.fen);
      setPendingMove(null);
      toast({
        title: "Connection Error",
        description: "Not connected to game server",
        variant: "destructive",
      });
    }
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const handleResign = () => {
    if (!gameId || gameOver) return;
    setShowResignConfirm(true);
  };

  const confirmResign = async () => {
    setShowResignConfirm(false);
    if (!gameId) return;
    try {
      const token = localStorage.getItem("auth_token");
      if (token) await api.resignGame(gameId, token);
    } catch (err) {
      console.error("Resign failed", err);
      toast({ title: "Resign failed", variant: "destructive" });
    }
  };

  // Navigation handler that cleans up socket before navigating
  const handleNavigateAway = useCallback(
    (path: string) => {
      // Leave game room and clean up listeners before navigating
      if (socket && gameId) {
        socket.off("game_state");
        socket.off("move_made");
        socket.off("move_error");
        socket.off("game_over");
        socket.emit("leave_game", gameId);
      }
      // Reset refs so component doesn't interfere if somehow still mounted
      claimingTimeoutRef.current = true;
      initialFetchDone.current = false;
      try {
        localStorage.setItem("tsg_just_left_game", JSON.stringify({ gameId, ts: Date.now() }));
      } catch {}
      navigate(path);
    },
    [socket, gameId, navigate],
  );

  // Generate PGN string from game data
  const generatePGN = useCallback(() => {
    const today = new Date();
    const dateStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getDate()).padStart(2, "0")}`;

    // Determine result
    let result = "*";
    if (gameOver) {
      if (gameOver.winner === "white") {
        result = "1-0";
      } else if (gameOver.winner === "black") {
        result = "0-1";
      } else if (gameOver.winner === "draw") {
        result = "1/2-1/2";
      }
    }

    // Build PGN headers
    const headers = [
      `[Event "Mates of KGP Game"]`,
      `[Site "Mates of KGP"]`,
      `[Date "${dateStr}"]`,
      `[White "${whitePlayerName}"]`,
      `[Black "${blackPlayerName}"]`,
      `[Result "${result}"]`,
    ];

    // Build move text
    const moveText = moves
      .map((move) => {
        if (move.black) {
          return `${move.number}. ${move.white} ${move.black}`;
        }
        return `${move.number}. ${move.white}`;
      })
      .join(" ");

    return `${headers.join("\n")}\n\n${moveText} ${result}`;
  }, [moves, whitePlayerName, blackPlayerName, gameOver]);

  // Download PGN file
  const handleDownloadPGN = useCallback(() => {
    const pgn = generatePGN();
    const blob = new Blob([pgn], { type: "application/x-chess-pgn" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `game-${gameId || "chess"}-${Date.now()}.pgn`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [generatePGN, gameId]);

  // Share PGN
  const handleSharePGN = useCallback(async () => {
    const pgn = generatePGN();

    // Try Web Share API first
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Mates of KGP - ${whitePlayerName} vs ${blackPlayerName}`,
          text: pgn,
        });
        return;
      } catch (err) {
        // User cancelled or share failed, fall through to clipboard
        if ((err as Error).name !== "AbortError") {
          console.error("Share failed:", err);
        }
      }
    }

    // Fallback: Copy to clipboard
    try {
      await navigator.clipboard.writeText(pgn);
      toast({ title: "PGN copied to clipboard!" });
    } catch (err) {
      console.error("Clipboard copy failed:", err);
      toast({ title: "Failed to copy PGN", variant: "destructive" });
    }
  }, [generatePGN, whitePlayerName, blackPlayerName]);

  // Render logic
  if (!isAuthenticated || !user) {
    return (
      <MainLayout>
        <div className='flex items-center justify-center min-h-screen'>
          <div className='text-center'>
            <div className='text-2xl font-bold mb-2 text-destructive'>Not authenticated</div>
            <Button onClick={() => navigate("/login")}>Go to Login</Button>
          </div>
        </div>
      </MainLayout>
    );
  }

  if (loading) {
    return (
      <MainLayout>
        <div className='flex items-center justify-center min-h-screen'>
          <div className='text-center'>
            <div className='text-2xl font-bold mb-2'>Loading game...</div>
            <div className='text-muted-foreground'>Please wait</div>
          </div>
        </div>
      </MainLayout>
    );
  }

  if ((error || gameNotFound) && !gameState) {
    return (
      <MainLayout>
        <div className='flex items-center justify-center min-h-screen'>
          <div className='text-center'>
            <div className='text-2xl font-bold mb-2 text-destructive'>Game Not Found</div>
            <div className='text-muted-foreground mb-4'>{error || "Game does not exist or has ended."}</div>
            <Button onClick={() => navigate("/play")}>Back to Matchmaking</Button>
          </div>
        </div>
      </MainLayout>
    );
  }

  if (!gameState) {
    return (
      <MainLayout>
        <div className='flex items-center justify-center min-h-screen'>
          <div className='text-center'>
            <div className='text-2xl font-bold mb-2'>Waiting for game data...</div>
          </div>
        </div>
      </MainLayout>
    );
  }

  let isWhiteTurn = true;
  try {
    chess.load(displayFen);
    isWhiteTurn = chess.turn() === "w";
  } catch {
    void 0;
  }

  const whitePlayerRating = whitePlayerInfo?.rating || 1200;
  const blackPlayerRating = blackPlayerInfo?.rating || 1200;

  const isMyTurn = (isWhiteTurn && isUserWhite) || (!isWhiteTurn && isUserBlack);
  const boardDisabled = gameOver !== null || !isMyTurn || pendingMove !== null;

  return (
    <MainLayout>
      <div className='flex flex-col md:flex-row min-h-screen'>
        <div className='flex-1 flex items-center justify-center p-4 sm:p-6 overflow-auto'>
          <div className='w-full max-w-[90vw] sm:max-w-[600px] flex flex-col gap-2'>
            {/* Controls */}
            <div className='flex justify-between items-center bg-card p-2 rounded border'>
              <div className='text-sm font-semibold'>{isConnected ? "🟢 Connected" : "🔴 Disconnected"}</div>
            </div>

            {/* Theme/Board selectors */}
            <div className='flex gap-2'>
              <select
                className='border p-2 rounded bg-background text-foreground text-xs'
                value={theme}
                onChange={(e) => setTheme(e.target.value)}>
                <option value='cardinal'>Cardinal</option>
                <option value='california'>California</option>
                <option value='cburnett'>CBurnett</option>
              </select>
              <select
                className='border p-2 rounded bg-background text-foreground text-xs'
                value={board}
                onChange={(e) => setBoard(e.target.value)}>
                <option value='wood.jpg'>Wood</option>
                <option value='blue-marble.jpg'>Blue Marble</option>
                <option value='wood3.jpg'>Wood 3</option>
              </select>
            </div>

            {/* Opponent info (always top) */}
            {isUserWhite ?
              <PlayerInfo
                username={blackPlayerName}
                rating={blackPlayerRating}
                isTop={true}
                timeLeft={formatTime(blackTimeLeft)}
                isActive={!isWhiteTurn && !gameOver}
              />
            : <PlayerInfo
                username={whitePlayerName}
                rating={whitePlayerRating}
                isTop={true}
                timeLeft={formatTime(whiteTimeLeft)}
                isActive={isWhiteTurn && !gameOver}
              />
            }

            {/* Chess board */}
            <ChessBoard
              theme={theme}
              boardImage={board}
              fen={displayFen}
              onMoveAttempt={handleMoveAttempt}
              disabled={boardDisabled}
              flipped={!isUserWhite}
            />

            {/* User info (always bottom) */}
            {isUserWhite ?
              <PlayerInfo
                username={whitePlayerName}
                rating={whitePlayerRating}
                isTop={false}
                timeLeft={formatTime(whiteTimeLeft)}
                isActive={isWhiteTurn && !gameOver}
              />
            : <PlayerInfo
                username={blackPlayerName}
                rating={blackPlayerRating}
                isTop={false}
                timeLeft={formatTime(blackTimeLeft)}
                isActive={!isWhiteTurn && !gameOver}
              />
            }

            {/* Game over modal */}
            {gameOver && (
              <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm'>
                <div className='relative bg-card border-2 border-border rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden'>
                  <div className='bg-gradient-to-r from-primary/20 to-accent/20 p-6 border-b border-border'>
                    <h2 className='text-3xl font-bold text-center text-foreground'>Game Over</h2>
                  </div>

                  <div className='p-6 space-y-6'>
                    <div className='text-center'>
                      {gameOver.winner === "draw" ?
                        <>
                          <div className='text-6xl mb-4'>🤝</div>
                          <div className='text-2xl font-bold text-yellow-500 mb-2'>Draw</div>
                          <div className='text-sm text-muted-foreground'>
                            by <span className='capitalize font-medium'>{gameOver.reason}</span>
                          </div>
                        </>
                      : <>
                          <div className='text-6xl mb-4'>{gameOver.winner === "white" ? "♔" : "♚"}</div>
                          <div className='text-2xl font-bold text-green-500 mb-2'>
                            {gameOver.winner === "white" ? whitePlayerName : blackPlayerName} Wins!
                          </div>
                          <div className='text-sm text-muted-foreground'>
                            by <span className='capitalize font-medium'>{gameOver.reason}</span>
                          </div>
                        </>
                      }
                    </div>

                    <div className='bg-secondary/30 rounded-xl p-4'>
                      {gameOver.noRatingChange ?
                        <div className='text-center'>
                          <div className='text-sm font-medium text-muted-foreground mb-1'>Rating Changes</div>
                          <div className='text-base text-yellow-600 dark:text-yellow-500 font-semibold'>
                            No rating change
                          </div>
                          <div className='text-xs text-muted-foreground mt-1'>(Both players must move)</div>
                        </div>
                      : <div>
                          <div className='text-sm font-medium text-center text-muted-foreground mb-3'>
                            Rating Changes
                          </div>
                          <div className='grid grid-cols-2 gap-4'>
                            <div className='bg-card rounded-lg p-3 text-center border border-border'>
                              <div className='text-xs text-muted-foreground mb-1'>{whitePlayerName}</div>
                              <div
                                className={`text-2xl font-bold ${
                                  (gameOver.whiteRatingChange || 0) > 0 ? "text-green-500"
                                  : (gameOver.whiteRatingChange || 0) < 0 ? "text-red-500"
                                  : "text-muted-foreground"
                                }`}>
                                {(gameOver.whiteRatingChange || 0) > 0 ? "+" : ""}
                                {gameOver.whiteRatingChange || 0}
                              </div>
                            </div>
                            <div className='bg-card rounded-lg p-3 text-center border border-border'>
                              <div className='text-xs text-muted-foreground mb-1'>{blackPlayerName}</div>
                              <div
                                className={`text-2xl font-bold ${
                                  (gameOver.blackRatingChange || 0) > 0 ? "text-green-500"
                                  : (gameOver.blackRatingChange || 0) < 0 ? "text-red-500"
                                  : "text-muted-foreground"
                                }`}>
                                {(gameOver.blackRatingChange || 0) > 0 ? "+" : ""}
                                {gameOver.blackRatingChange || 0}
                              </div>
                            </div>
                          </div>
                        </div>
                      }
                    </div>

                    {/* Download & Share Buttons */}
                    <div className='flex gap-3 mb-3'>
                      <button
                        onClick={handleDownloadPGN}
                        className='flex-1 px-4 py-3 rounded-lg bg-secondary text-secondary-foreground font-semibold hover:bg-secondary/80 border border-border flex items-center justify-center gap-2'>
                        <Download size={18} />
                        Download PGN
                      </button>
                      <button
                        onClick={handleSharePGN}
                        className='flex-1 px-4 py-3 rounded-lg bg-secondary text-secondary-foreground font-semibold hover:bg-secondary/80 border border-border flex items-center justify-center gap-2'>
                        <Share2 size={18} />
                        Share
                      </button>
                    </div>

                    <div className='flex gap-3'>
                      <button
                        className='flex-1 px-4 py-3 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90'
                        onClick={() => handleNavigateAway("/play")}>
                        Play Again
                      </button>
                      <button
                        className='flex-1 px-4 py-3 rounded-lg bg-secondary text-secondary-foreground font-semibold hover:bg-secondary/80 border border-border'
                        onClick={() => handleNavigateAway("/")}>
                        Home
                      </button>
                    </div>
                  </div>

                  <button
                    aria-label='Close'
                    onClick={() => handleNavigateAway("/play")}
                    className='absolute top-4 right-4 w-8 h-8 rounded-full bg-secondary hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors flex items-center justify-center'>
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* Resign Confirmation Modal */}
            {showResignConfirm && (
              <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm'>
                <div className='relative bg-card border-2 border-border rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden'>
                  <div className='bg-gradient-to-r from-destructive/20 to-red-600/20 p-5 border-b border-border'>
                    <h2 className='text-2xl font-bold text-center text-foreground'>Resign Game?</h2>
                  </div>

                  <div className='p-6 space-y-4'>
                    <div className='text-center'>
                      <div className='text-5xl mb-4'>🏳️</div>
                      <p className='text-muted-foreground'>
                        Are you sure you want to resign this game? This action cannot be undone.
                      </p>
                    </div>

                    <div className='flex gap-3'>
                      <button
                        className='flex-1 px-4 py-3 rounded-lg bg-secondary text-secondary-foreground font-semibold hover:bg-secondary/80 border border-border'
                        onClick={() => setShowResignConfirm(false)}>
                        Cancel
                      </button>
                      <button
                        className='flex-1 px-4 py-3 rounded-lg bg-destructive text-destructive-foreground font-semibold hover:bg-destructive/90'
                        onClick={confirmResign}>
                        Resign
                      </button>
                    </div>
                  </div>

                  <button
                    aria-label='Close'
                    onClick={() => setShowResignConfirm(false)}
                    className='absolute top-4 right-4 w-8 h-8 rounded-full bg-secondary hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors flex items-center justify-center'>
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Side panel with chat */}
        <div className='w-full md:w-80 md:border-l border-t md:border-t-0 p-4'>
          <GamePanel
            className='h-full'
            moves={moves}
            gameId={gameId}
            currentUserId={user.userId}
            onResign={handleResign}
            gameOver={!!gameOver}
            whitePlayerName={whitePlayerName}
            blackPlayerName={blackPlayerName}
            gameResult={gameOver}
            fen={displayFen}
          />
        </div>
      </div>
    </MainLayout>
  );
};

export default Game;
