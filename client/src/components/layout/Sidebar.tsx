import React from 'react';
import { Link } from 'react-router-dom';
import { NavLink } from '@/components/NavLink';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import {
  Gamepad2,
  Puzzle,
  GraduationCap,
  Eye,
  Users,
  Wrench,
  User,
  Globe,
  HelpCircle,
  Crown
} from 'lucide-react';

import { SheetClose } from "@/components/ui/sheet";
interface SidebarProps {
  className?: string;
  showCloseButton?: boolean;
}

const navItems = [
  { icon: Gamepad2, label: 'Play', path: '/play' },
  { icon: User, label: 'Profile', path: '/profile' },
  { icon: Users, label: 'Friends', path: '/friends' },
  { icon: Crown, label: 'Leaderboard', path: '/leaderboard' },
];

export const Sidebar: React.FC<SidebarProps> = ({ className, showCloseButton }) => {
  const { user, isAuthenticated, logout } = useAuth();

  const handleLogout = () => {
    logout();
    toast({ title: 'Logged out', description: 'You have been successfully logged out' });
  };

  return (
    <aside className={cn(
      "min-w min-h-screen bg-sidebar flex flex-col border-r border-sidebar-border relative",
      className
    )}>
      {/* Logo */}
      <div className="p-4">
        <NavLink to="/" className="flex items-center gap-2 group">
          <span className="text-primary text-2xl">♔</span>
          <span className="font-bold text-lg text-foreground">
            Mates of <span className="text-primary">KGP</span>
          </span>
        </NavLink>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className="sidebar-item"
            activeClassName="sidebar-item-active"
          >
            <item.icon size={20} />
            <span className="font-medium">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Auth Section */}
      <div className="p-4 space-y-2">
        {!isAuthenticated && (
          <>
            <Link to="/signup" className="btn-accent w-full block text-center">
              Sign Up
            </Link>
            <Link to="/login" className="btn-outline w-full block text-center">
              Login
            </Link>
          </>
        )}
        {isAuthenticated && (
          <>
            <div className="text-sm mb-2 px-2">
              Hello, <b>{user?.username}</b>
            </div>
            <button className="btn-outline w-full" onClick={handleLogout}>
              Log Out
            </button>
          </>
        )}
      </div>

      {/* Footer Links */}
      <div className="px-4 pb-4 space-y-2">
        <button className="sidebar-item w-full">
          <Globe size={18} />
          <span className="text-sm">English</span>
        </button>
        <a
          href="mailto:tech.coordi@iitkgp.ac.in"
          className="sidebar-item w-full"
        >
          <HelpCircle size={18} />
          <span className="text-sm">Support</span>
        </a>
      </div>
    </aside>
  );
};

export default Sidebar;
