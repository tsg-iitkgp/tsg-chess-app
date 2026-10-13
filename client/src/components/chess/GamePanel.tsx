import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { MoveList } from './MoveList';
import { Flag, Share2, Download, Send, Handshake } from 'lucide-react';
import { useSocket } from '@/context/SocketContext';

interface Move {
  number: number;
  white: string;
  black?: string;
}

interface ChatMessage {
  id: string;
  gameId: string;
  userId: string;
  username: string;
  message: string;
  timestamp: number;
}

interface GamePanelProps {
  className?: string;
  moves?: Move[];
  gameId?: string;
  currentUserId?: string;
  onResign?: () => void;
  onOfferDraw?: () => void;
  gameOver?: boolean;
  whitePlayerName?: string;
  blackPlayerName?: string;
  gameResult?: { winner: string; reason: string } | null;
  fen?: string;
}

export const GamePanel: React.FC<GamePanelProps> = ({
  className,
  moves = [],
  gameId,
  currentUserId,
  onResign,
  onOfferDraw,
  gameOver = false,
  whitePlayerName = 'White',
  blackPlayerName = 'Black',
  gameResult = null,
  fen,
}) => {
  const [activeTab, setActiveTab] = useState<'play' | 'chat'>('play');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [opponentTyping, setOpponentTyping] = useState(false);
  const [drawOffered, setDrawOffered] = useState(false);
  const [drawOfferReceived, setDrawOfferReceived] = useState<{ offeredBy: string; username: string } | null>(null);

  const { socket } = useSocket();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Fetch chat history when joining game
  useEffect(() => {
    if (!socket || !gameId) return;

    socket.emit('get_chat_history', gameId);

    const onChatHistory = (data: { gameId: string; messages: ChatMessage[] }) => {
      if (data.gameId === gameId) {
        setMessages(data.messages);
      }
    };

    const onChatMessage = (msg: ChatMessage) => {
      if (msg.gameId === gameId) {
        setMessages(prev => [...prev, msg]);
      }
    };

    const onOpponentTyping = (data: { userId: string; isTyping: boolean }) => {
      if (data.userId !== currentUserId) {
        setOpponentTyping(data.isTyping);
      }
    };

    const onDrawOffered = (data: { gameId: string; offeredBy: string; username: string }) => {
      if (data.gameId === gameId) {
        setDrawOfferReceived({ offeredBy: data.offeredBy, username: data.username });
      }
    };

    const onDrawOfferSent = () => {
      setDrawOffered(true);
    };

    const onDrawDeclined = () => {
      setDrawOffered(false);
    };

    socket.on('chat_history', onChatHistory);
    socket.on('chat_message', onChatMessage);
    socket.on('opponent_typing', onOpponentTyping);
    socket.on('draw_offered', onDrawOffered);
    socket.on('draw_offer_sent', onDrawOfferSent);
    socket.on('draw_declined', onDrawDeclined);

    return () => {
      socket.off('chat_history', onChatHistory);
      socket.off('chat_message', onChatMessage);
      socket.off('opponent_typing', onOpponentTyping);
      socket.off('draw_offered', onDrawOffered);
      socket.off('draw_offer_sent', onDrawOfferSent);
      socket.off('draw_declined', onDrawDeclined);
    };
  }, [socket, gameId, currentUserId]);

  const handleSendMessage = useCallback(() => {
    if (!socket || !gameId || !newMessage.trim()) return;

    socket.emit('chat_message', {
      gameId,
      message: newMessage.trim(),
    });

    setNewMessage('');

    // Stop typing indicator
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    socket.emit('typing_stop', gameId);
    setIsTyping(false);
  }, [socket, gameId, newMessage]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);

    if (!socket || !gameId) return;

    // Typing indicator logic
    if (!isTyping) {
      setIsTyping(true);
      socket.emit('typing_start', gameId);
    }

    // Reset timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      socket.emit('typing_stop', gameId);
    }, 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleAcceptDraw = () => {
    if (socket && gameId) {
      socket.emit('accept_draw', gameId);
      setDrawOfferReceived(null);
    }
  };

  const handleDeclineDraw = () => {
    if (socket && gameId) {
      socket.emit('decline_draw', gameId);
      setDrawOfferReceived(null);
    }
  };

  const handleOfferDraw = () => {
    if (socket && gameId && !drawOffered) {
      socket.emit('offer_draw', gameId);
      onOfferDraw?.();
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Generate PGN string from game data
  const generatePGN = useCallback(() => {
    const today = new Date();
    const dateStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;

    // Determine result
    let result = '*';
    if (gameResult) {
      if (gameResult.winner === 'white') {
        result = '1-0';
      } else if (gameResult.winner === 'black') {
        result = '0-1';
      } else if (gameResult.winner === 'draw') {
        result = '1/2-1/2';
      }
    }

    // Build PGN headers
    const headers = [
      `[Event "TSG Chess Arena Game"]`,
      `[Site "TSG Chess Arena"]`,
      `[Date "${dateStr}"]`,
      `[White "${whitePlayerName}"]`,
      `[Black "${blackPlayerName}"]`,
      `[Result "${result}"]`,
    ];

    if (fen && fen !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') {
      headers.push(`[FEN "${fen}"]`);
    }

    // Build move text
    const moveText = moves.map(move => {
      if (move.black) {
        return `${move.number}. ${move.white} ${move.black}`;
      }
      return `${move.number}. ${move.white}`;
    }).join(' ');

    return `${headers.join('\n')}\n\n${moveText} ${result}`;
  }, [moves, whitePlayerName, blackPlayerName, gameResult, fen]);

  // Download PGN file
  const handleDownloadPGN = useCallback(() => {
    const pgn = generatePGN();
    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `game-${gameId || 'chess'}-${Date.now()}.pgn`;
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
          title: `Chess Game - ${whitePlayerName} vs ${blackPlayerName}`,
          text: pgn,
        });
        return;
      } catch (err) {
        // User cancelled or share failed, fall through to clipboard
        if ((err as Error).name !== 'AbortError') {
          console.error('Share failed:', err);
        }
      }
    }

    // Fallback: Copy to clipboard
    try {
      await navigator.clipboard.writeText(pgn);
      // Show a brief visual feedback (could use toast, but keeping it simple)
      alert('PGN copied to clipboard!');
    } catch (err) {
      console.error('Clipboard copy failed:', err);
      alert('Failed to copy PGN to clipboard');
    }
  }, [generatePGN, whitePlayerName, blackPlayerName]);

  return (
    <div className={cn("flex flex-col h-full bg-card rounded-lg overflow-hidden", className)}>
      {/* Header Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab('play')}
          className={cn(
            "flex-1 py-3 px-4 text-sm font-medium transition-colors",
            activeTab === 'play'
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Play
        </button>
        <button
          onClick={() => setActiveTab('chat')}
          className={cn(
            "flex-1 py-3 px-4 text-sm font-medium transition-colors relative",
            activeTab === 'chat'
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Chat Box
          {messages.length > 0 && activeTab !== 'chat' && (
            <span className="absolute top-2 right-2 w-2 h-2 bg-primary rounded-full" />
          )}
        </button>
      </div>

      {/* Draw Offer Alert */}
      {drawOfferReceived && (
        <div className="mx-4 mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <p className="text-sm text-yellow-600 dark:text-yellow-400 mb-2">
            {drawOfferReceived.username} offers a draw
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleAcceptDraw}
              className="flex-1 py-1.5 bg-green-500/20 text-green-600 dark:text-green-400 text-sm rounded hover:bg-green-500/30 transition-colors"
            >
              Accept
            </button>
            <button
              onClick={handleDeclineDraw}
              className="flex-1 py-1.5 bg-red-500/20 text-red-600 dark:text-red-400 text-sm rounded hover:bg-red-500/30 transition-colors"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex flex-col p-4 overflow-hidden">
        {activeTab === 'play' ? (
          <>
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Moves</h3>
            <MoveList moves={moves} />
          </>
        ) : (
          <div className="flex-1 flex flex-col">
            <div className="flex-1 overflow-y-auto space-y-2">
              {messages.length === 0 ? (
                <p className="text-center py-8 text-sm text-muted-foreground">
                  No messages yet. Say hi! 👋
                </p>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex flex-col gap-0.5 p-2 rounded-lg max-w-[85%]",
                      msg.userId === currentUserId
                        ? "ml-auto bg-primary/10 text-foreground"
                        : "mr-auto bg-secondary text-foreground"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-primary">
                        {msg.userId === currentUserId ? 'You' : msg.username}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm break-words">{msg.message}</p>
                  </div>
                ))
              )}
              {opponentTyping && (
                <div className="text-xs text-muted-foreground italic">
                  Opponent is typing...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={newMessage}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                disabled={gameOver}
                className="flex-1 px-3 py-2 bg-secondary rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
              <button
                onClick={handleSendMessage}
                disabled={!newMessage.trim() || gameOver}
                className="p-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="p-4 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={handleSharePGN}
              className="p-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Share game"
            >
              <Share2 size={18} />
            </button>
            <button
              onClick={handleDownloadPGN}
              className="p-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Download PGN"
            >
              <Download size={18} />
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleOfferDraw}
              disabled={gameOver || drawOffered}
              className={cn(
                "p-2 rounded-lg bg-secondary transition-colors",
                drawOffered
                  ? "text-yellow-500 cursor-not-allowed"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title={drawOffered ? "Draw offered" : "Offer draw"}
            >
              <Handshake size={18} />
            </button>
            <button
              onClick={onResign}
              disabled={gameOver}
              className="p-2 rounded-lg bg-secondary text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
              title="Resign"
            >
              <Flag size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GamePanel;
