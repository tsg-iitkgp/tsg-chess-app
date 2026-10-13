import React from 'react';
import { Sidebar } from './Sidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetTrigger, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Menu } from 'lucide-react';
import { useEffect } from 'react';
import { useSocket } from '@/context/SocketContext';
import { useToast } from '@/components/ui/use-toast';
import { useNavigate } from 'react-router-dom';

interface MainLayoutProps {
  children: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const isMobile = useIsMobile();
  const { socket } = useSocket();
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (!socket) return;

    // Friend Request Notifications
    socket.on('friend_request_received', (data: { sender: { username: string } }) => {
      toast({
        title: "New Friend Request",
        description: `${data.sender.username} sent you a friend request`,
        action: <Button variant="outline" size="sm" onClick={() => navigate('/friends')}>View</Button>
      });
    });

    socket.on('friend_request_accepted', (data: { friend: { username: string } }) => {
      toast({
        title: "Friend Request Accepted",
        description: `${data.friend.username} is now your friend!`,
      });
    });

    // Challenge Notifications
    socket.on('challenge_received', (data: { challengeId: string, challenger: { username: string, rating: number }, timeControl: string }) => {
      toast({
        title: "Challenge Received",
        description: `${data.challenger.username} challenged you to a friendly ${data.timeControl} game!`,
        action: <Button variant="outline" size="sm" onClick={() => navigate('/friends')}>View</Button>
      });
    });

    socket.on('challenge_accepted', (data: { gameId: string }) => {
      toast({
        title: "Challenge Accepted!",
        description: "Game is starting...",
      });
      navigate(`/game/${data.gameId}`);
    });

    socket.on('challenge_declined', () => {
      toast({
        title: "Challenge Declined",
        description: "Your challenge was declined.",
        variant: "destructive"
      });
    });

    return () => {
      socket.off('friend_request_received');
      socket.off('friend_request_accepted');
      socket.off('challenge_received');
      socket.off('challenge_accepted');
      socket.off('challenge_declined');
    };
  }, [socket, toast, navigate]);

  if (isMobile) {
    return (
      <div className="relative min-h-screen bg-background">
        <div className="fixed top-0 left-0 w-full z-50 bg-sidebar flex items-center justify-between px-4 h-14 border-b border-border shadow-sm">
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="shadow md:hidden"
                aria-label="Open sidebar menu"
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="pl-0 p-0 w-64 max-w-full md:hidden"
              aria-labelledby="mobile-sidebar-title"
              aria-describedby="mobile-sidebar-description"
            >
              <div className="sr-only" id="mobile-sidebar-title">Navigation menu</div>
              <div className="sr-only" id="mobile-sidebar-description">Sidebar navigation links</div>
              <Sidebar showCloseButton />
            </SheetContent>
          </Sheet>
          <span className="font-bold text-lg text-foreground flex items-center gap-2 mx-auto absolute left-1/2 -translate-x-1/2 whitespace-nowrap">
            <span className="text-primary text-2xl">♔</span>
            <span>TSG Chess <span className="text-primary">Arena</span></span>
          </span>
          {/* Dummy flex box for symmetry, can be hidden or used for spacing */}
          <div className="w-10 h-10" />
        </div>
        <main className="pt-16 md:pt-0">{children}</main>
      </div>
    );
  }

  // Desktop/tablet: show sidebar as before
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
};

export default MainLayout;
